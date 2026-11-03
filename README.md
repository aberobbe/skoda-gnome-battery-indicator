# Škoda EV Battery – GNOME Shell extension

Shows your Škoda EV's state of charge in the top bar, using the
[MyŠkoda public API](https://public.api.connect.skoda-auto.cz/docs/swagger-ui/index.html)
(`GET /api/v1/vehicles/{vin}?include=info,charging`, `X-API-Key` header).

## Setup
1. Create an API key in the MyŠkoda app (https://go.skoda.eu/api-keys) and select your car.
2. `./install.sh`, log out/in, then `gnome-extensions enable skoda-battery@robbeabe.github.io`.
3. Open the settings (`gnome-extensions prefs skoda-battery@robbeabe.github.io` or the menu), and enter the VIN and API key. Then pick 10, 20 or 30 minutes.

## API key storage
The key is stored only through libsecret in the GNOME Keyring. The keyring encrypts it on disk and unlocks it with your login. It never goes to GSettings/dconf or any plain file. To inspect or remove it, use *Passwords and Keys* (Seahorse) and look for "Škoda EV Battery – MyŠkoda API key", or click *Remove* in the settings.
