// Print a new Web Push (VAPID) key pair: the public key for VAPID_PUBLIC_KEY
// in wrangler.jsonc, and the private key for the VAPID_PRIVATE_KEY secret.
// Replacing the pair stops every existing subscription; devices re-enable.
import { base64url } from "../src/push/webpush";

const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"])) as CryptoKeyPair;
const publicKey = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
const { d } = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
console.log(`VAPID_PUBLIC_KEY=${base64url(publicKey)}\nVAPID_PRIVATE_KEY=${d}`);
