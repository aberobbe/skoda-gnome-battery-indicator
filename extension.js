import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Soup from 'gi://Soup?version=3.0';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {lookupApiKey} from './secret.js';

const API_BASE = 'https://public.api.connect.skoda-auto.cz/api/v1/vehicles/';
const ALLOWED_INTERVALS = [10, 20, 30, 45, 60, 90, 120];
const CHARGING_INTERVAL = 15;

const CHARGING_STATES = {
    CONNECT_CABLE: 'Cable not connected',
    CHARGING: 'Charging',
    CONSERVING: 'Conserving',
    READY_FOR_CHARGING: 'Ready for charging',
    DISCHARGING: 'Discharging',
    CHARGING_INTERRUPTED: 'Charging interrupted',
};

function formatTime(iso) {
    if (!iso)
        return '—';
    const dt = GLib.DateTime.new_from_iso8601(iso, null);
    return dt ? dt.to_local().format('%a %H:%M') : iso;
}

const SkodaIndicator = GObject.registerClass(
class SkodaIndicator extends PanelMenu.Button {
    _init(ext) {
        super._init(0.0, 'Škoda EV Battery');
        this._ext = ext;
        this._settings = ext.getSettings();
        this._session = new Soup.Session({timeout: 30});
        this._cancellable = new Gio.Cancellable();
        this._timerId = 0;
        this._busy = false;
        this._charging = false;
        this._scheduledMinutes = 0;

        const box = new St.BoxLayout({style_class: 'panel-status-menu-box'});
        this._bolt = new St.Icon({
            gicon: Gio.icon_new_for_string(`${ext.path}/icons/skoda-bolt-symbolic.svg`),
            style_class: 'system-status-icon',
            visible: false,
        });
        this._label = new St.Label({
            text: '--%',
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(this._bolt);
        box.add_child(this._label);
        this.add_child(box);

        this._nameItem = this._infoItem('Škoda');
        this._rangeItem = this._infoItem('Range: —');
        this._stateItem = this._infoItem('Status: —');
        this._updatedItem = this._infoItem('Car data from: —');
        this._errorItem = this._infoItem('');
        this._errorItem.visible = false;
        this._expiryItem = this._infoItem('');
        this._expiryItem.visible = false;

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addAction('Refresh now', () => this._refresh());
        this.menu.addAction('Settings', () => this._ext.openPreferences());

        this._settingsIds = [
            this._settings.connect('changed::poll-interval', () => this._schedule()),
            this._settings.connect('changed::charging-poll', () => this._schedule()),
            this._settings.connect('changed::vin', () => this._refresh()),
            this._settings.connect('changed::key-revision', () => this._refresh()),
        ];

        this._schedule();
        this._refresh();
    }

    _infoItem(text) {
        const item = new PopupMenu.PopupMenuItem(text, {reactive: false});
        this.menu.addMenuItem(item);
        return item;
    }

    _intervalMinutes() {
        const v = this._settings.get_uint('poll-interval');
        const base = ALLOWED_INTERVALS.includes(v) ? v : 20;
        // While charging, poll every 15 min, unless the normal interval is already shorter.
        if (this._charging && this._settings.get_boolean('charging-poll'))
            return Math.min(base, CHARGING_INTERVAL);
        return base;
    }

    _schedule() {
        if (this._timerId)
            GLib.source_remove(this._timerId);
        this._scheduledMinutes = this._intervalMinutes();
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,
            this._scheduledMinutes * 60, () => {
                this._refresh();
                return GLib.SOURCE_CONTINUE;
            });
    }

    _setError(msg) {
        this._errorItem.label.text = `⚠ ${msg}`;
        this._errorItem.visible = true;
    }

    async _refresh() {
        if (this._busy)
            return;
        this._busy = true;
        try {
            await this._doRefresh();
        } catch (e) {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                this._setError(e.message);
                console.warn(`[skoda-battery] ${e.message}`);
            }
        } finally {
            this._busy = false;
        }
    }

    async _doRefresh() {
        const vin = this._settings.get_string('vin').trim().toUpperCase();
        if (vin.length !== 17) {
            this._setError('Set your 17-character VIN in Settings');
            return;
        }
        const apiKey = await lookupApiKey(this._cancellable);
        if (!apiKey) {
            this._setError('Set your API key in Settings');
            return;
        }

        const msg = Soup.Message.new('GET',
            `${API_BASE}${encodeURIComponent(vin)}?include=info,charging`);
        msg.request_headers.append('X-API-Key', apiKey);
        msg.request_headers.append('Accept', 'application/json');

        const bytes = await new Promise((resolve, reject) => {
            this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT,
                this._cancellable, (s, res) => {
                    try {
                        resolve(s.send_and_read_finish(res));
                    } catch (e) {
                        reject(e);
                    }
                });
        });

        const status = msg.get_status();
        const text = new TextDecoder().decode(bytes.get_data() ?? new Uint8Array());
        const headers = msg.get_response_headers();
        this._showExpiry(headers.get_one('X-API-Key-Expires-At'));

        if (status !== 200) {
            let detail = '';
            try {
                const p = JSON.parse(text);
                detail = p.detail || p.title || '';
            } catch {}
            const hint = {
                401: 'API key invalid or expired',
                403: 'API key has no access to this vehicle',
                404: 'Vehicle not found',
                429: `Rate limited (retry after ${headers.get_one('Retry-After') ?? '?'}s)`,
                503: 'Service unavailable',
            }[status] ?? `HTTP ${status}`;
            throw new Error(detail ? `${hint}: ${detail}` : hint);
        }

        const data = JSON.parse(text);
        this._update(data);
    }

    _showExpiry(expiresAt) {
        if (!expiresAt) {
            this._expiryItem.visible = false;
            return;
        }
        const dt = GLib.DateTime.new_from_iso8601(expiresAt, null);
        if (!dt) {
            this._expiryItem.visible = false;
            return;
        }
        const days = Math.floor(dt.difference(GLib.DateTime.new_now_utc()) / GLib.TIME_SPAN_DAY);
        this._expiryItem.label.text = `API key expires ${dt.to_local().format('%Y-%m-%d')}` +
            (days <= 14 ? ` (${days} days left!)` : '');
        this._expiryItem.visible = true;
    }

    _update(data) {
        const v = data.vehicle ?? {};
        const charging = v.charging;
        const cs = charging?.status;
        const soc = cs?.battery?.stateOfChargeInPercent;

        this._nameItem.label.text = v.licensePlate
            ? `${v.name ?? 'Škoda'} (${v.licensePlate})` : (v.name ?? 'Škoda');

        const chargingErr = (data.errors ?? []).find(e => String(e.type ?? '').startsWith('CHARGING'));
        if (typeof soc !== 'number') {
            this._setError(chargingErr ? `Charging data: ${chargingErr.type}` : 'No battery data returned');
            return;
        }
        this._errorItem.visible = false;

        const isCharging = cs.state === 'CHARGING';
        this._bolt.visible = isCharging;
        this._charging = isCharging;
        if (this._intervalMinutes() !== this._scheduledMinutes)
            this._schedule();
        this._label.text = `${soc}%`;

        const rangeM = cs.battery.remainingCruisingRangeInMeters;
        this._rangeItem.label.text = `Range: ${typeof rangeM === 'number' ? Math.round(rangeM / 1000) + ' km' : '—'}`;

        let state = CHARGING_STATES[cs.state] ?? 'Unknown';
        if (cs.plugConnectionState === 'CONNECTED' && cs.state !== 'CHARGING')
            state += ' · plugged in';
        if (isCharging) {
            if (typeof cs.chargePowerInKw === 'number')
                state += ` · ${cs.chargePowerInKw} kW ${cs.chargeType ?? ''}`.trimEnd();
            if (typeof cs.remainingTimeToFullyChargedInMinutes === 'number') {
                const m = cs.remainingTimeToFullyChargedInMinutes;
                state += ` · ${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')} left`;
            }
        }
        this._stateItem.label.text = `Status: ${state}`;
        this._updatedItem.label.text = `Car data from: ${formatTime(charging.carCapturedTimestamp)}`;
    }

    destroy() {
        this._cancellable.cancel();
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }
        this._settingsIds.forEach(id => this._settings.disconnect(id));
        this._session.abort();
        this._settings = null;
        super.destroy();
    }
});

export default class SkodaBatteryExtension extends Extension {
    enable() {
        this._indicator = new SkodaIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
