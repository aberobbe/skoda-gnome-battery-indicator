// API key storage via libsecret (GNOME Keyring / any Secret Service provider).
// The key is never written to GSettings or any plain file: the keyring
// stores it encrypted and unlocks it with the user's login.
import Secret from 'gi://Secret';

const SCHEMA = new Secret.Schema(
    'org.gnome.shell.extensions.skoda-battery',
    Secret.SchemaFlags.NONE,
    {service: Secret.SchemaAttributeType.STRING}
);
const ATTRS = {service: 'myskoda-public-api'};
const LABEL = 'Škoda EV Battery – MyŠkoda API key';

export function lookupApiKey(cancellable = null) {
    return new Promise((resolve, reject) => {
        Secret.password_lookup(SCHEMA, ATTRS, cancellable, (_s, res) => {
            try {
                resolve(Secret.password_lookup_finish(res));
            } catch (e) {
                reject(e);
            }
        });
    });
}

export function storeApiKey(key, cancellable = null) {
    return new Promise((resolve, reject) => {
        Secret.password_store(SCHEMA, ATTRS, Secret.COLLECTION_DEFAULT,
            LABEL, key, cancellable, (_s, res) => {
                try {
                    resolve(Secret.password_store_finish(res));
                } catch (e) {
                    reject(e);
                }
            });
    });
}

export function clearApiKey(cancellable = null) {
    return new Promise((resolve, reject) => {
        Secret.password_clear(SCHEMA, ATTRS, cancellable, (_s, res) => {
            try {
                resolve(Secret.password_clear_finish(res));
            } catch (e) {
                reject(e);
            }
        });
    });
}
