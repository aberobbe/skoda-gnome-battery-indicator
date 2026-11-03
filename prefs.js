import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {lookupApiKey, storeApiKey, clearApiKey} from './secret.js';

export default class SkodaBatteryPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings;

        const page = new Adw.PreferencesPage();
        window.add(page);

        // --- Vehicle -----------------------------------------------------
        const vehicle = new Adw.PreferencesGroup({
            title: 'Vehicle',
            description: 'Create an API key in the MyŠkoda app (go.skoda.eu/api-keys) and select this vehicle for it.',
        });
        page.add(vehicle);

        const vinRow = new Adw.EntryRow({title: 'VIN (17 characters)'});
        vinRow.text = settings.get_string('vin');
        vinRow.connect('changed', () => {
            const vin = vinRow.text.trim().toUpperCase();
            const ok = vin.length === 17 || vin.length === 0;
            if (ok)
                vinRow.remove_css_class('error');
            else
                vinRow.add_css_class('error');
            if (vin.length === 17 && vin !== settings.get_string('vin'))
                settings.set_string('vin', vin);
        });
        vehicle.add(vinRow);

        // --- API key (keyring only) ---------------------------------------
        const keyGroup = new Adw.PreferencesGroup({
            title: 'API key',
            description: 'Stored only in the GNOME Keyring (encrypted), never in settings or files.',
        });
        page.add(keyGroup);

        const keyRow = new Adw.PasswordEntryRow({
            title: 'Enter new API key',
            show_apply_button: true,
        });
        keyGroup.add(keyRow);

        const statusRow = new Adw.ActionRow({title: 'Keyring status', subtitle: 'Checking…'});
        const clearBtn = new Gtk.Button({
            label: 'Remove',
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action'],
            sensitive: false,
        });
        statusRow.add_suffix(clearBtn);
        keyGroup.add(statusRow);

        const refreshStatus = async () => {
            try {
                const k = await lookupApiKey();
                statusRow.subtitle = k ? 'An API key is stored' : 'No API key stored';
                clearBtn.sensitive = !!k;
            } catch (e) {
                statusRow.subtitle = `Keyring error: ${e.message}`;
            }
        };
        const bump = () => settings.set_uint('key-revision',
            (settings.get_uint('key-revision') + 1) >>> 0);

        keyRow.connect('apply', async () => {
            const key = keyRow.text.trim();
            keyRow.text = '';
            if (!key)
                return;
            try {
                await storeApiKey(key);
                bump();
                window.add_toast(new Adw.Toast({title: 'API key saved to keyring'}));
            } catch (e) {
                window.add_toast(new Adw.Toast({title: `Could not save: ${e.message}`}));
            }
            refreshStatus();
        });

        clearBtn.connect('clicked', async () => {
            try {
                await clearApiKey();
                bump();
                window.add_toast(new Adw.Toast({title: 'API key removed'}));
            } catch (e) {
                window.add_toast(new Adw.Toast({title: `Could not remove: ${e.message}`}));
            }
            refreshStatus();
        });
        refreshStatus();

        // --- Polling -----------------------------------------------------
        const pollGroup = new Adw.PreferencesGroup({title: 'Polling'});
        page.add(pollGroup);

        const minutesRow = (title, subtitle, key) => {
            const row = new Adw.SpinRow({
                title,
                subtitle,
                adjustment: new Gtk.Adjustment({
                    lower: 1, upper: 1440, step_increment: 1, page_increment: 10,
                }),
                digits: 0,
                numeric: true,
            });
            settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
            return row;
        };

        pollGroup.add(minutesRow('Refresh every (minutes)',
            'While the car is not charging', 'poll-interval'));

        const chargingRow = new Adw.SwitchRow({
            title: 'Use a different interval while charging',
        });
        settings.bind('charging-poll', chargingRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        pollGroup.add(chargingRow);

        const chargingIntervalRow = minutesRow('Refresh while charging (minutes)',
            'While the car is charging', 'charging-interval');
        settings.bind('charging-poll', chargingIntervalRow, 'sensitive', Gio.SettingsBindFlags.GET);
        pollGroup.add(chargingIntervalRow);
    }
}
