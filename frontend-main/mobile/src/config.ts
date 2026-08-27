/**
 * Where the API lives - configuration, not code.
 *
 * The old app hardcoded a LAN IP in a source file, which meant editing code
 * every time the laptop's address changed. Now it comes from an Expo public
 * env var, set per machine and never committed:
 *
 *     # .env (see .env.example)
 *     EXPO_PUBLIC_API_BASE=http://192.168.1.23:8000
 *
 * `localhost` on a phone means the phone, so this must be the laptop's LAN
 * address (`ipconfig getifaddr en0` on macOS), the API started with
 * `./run.sh --lan` or `--host 0.0.0.0`, and both devices on the same WiFi.
 *
 * The fallback keeps the iOS *simulator* working with zero setup - the
 * simulator shares the Mac's network, so 127.0.0.1 reaches it there and
 * nowhere else.
 */
const env = (process.env as Record<string, string | undefined>).EXPO_PUBLIC_API_BASE;

export const API_BASE = (env ?? 'http://127.0.0.1:8000').replace(/\/+$/, '');

export const API_BASE_IS_DEFAULT = !env;
