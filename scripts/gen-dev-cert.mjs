// Genera un certificado autofirmado de DESARROLLO (PKCS#12 / .p12) para firmar
// PDFs en local. NO usar en producción — ahí va un certificado de una CA real.
//
//   node scripts/gen-dev-cert.mjs
//
// Salida:
//   - certs/dev-signer.p12        (para inspección)
//   - imprime SIGN_P12_BASE64 y SIGN_P12_PASS para la edge function.

import forge from "node-forge";
import { mkdirSync, writeFileSync } from "node:fs";

const PASS = "firmadrive-dev";

const keys = forge.pki.rsa.generateKeyPair(2048);
const cert = forge.pki.createCertificate();
cert.publicKey = keys.publicKey;
cert.serialNumber = "01";
cert.validity.notBefore = new Date();
cert.validity.notAfter = new Date();
cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 5);

const attrs = [
  { name: "commonName", value: "FirmaDrive Dev Signer" },
  { name: "organizationName", value: "FirmaDrive" },
  { name: "countryName", value: "PE" },
];
cert.setSubject(attrs);
cert.setIssuer(attrs); // autofirmado
cert.setExtensions([
  { name: "basicConstraints", cA: false },
  { name: "keyUsage", digitalSignature: true, nonRepudiation: true },
  { name: "extKeyUsage", clientAuth: true, emailProtection: true },
]);
cert.sign(keys.privateKey, forge.md.sha256.create());

const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], PASS, {
  algorithm: "3des",
});
const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
const p12b64 = forge.util.encode64(p12Der);

mkdirSync("certs", { recursive: true });
writeFileSync("certs/dev-signer.p12", Buffer.from(p12Der, "binary"));

console.log("Certificado dev generado en certs/dev-signer.p12\n");
console.log("Pega esto en supabase/functions/.env :\n");
console.log(`SIGN_P12_PASS=${PASS}`);
console.log(`SIGN_P12_BASE64=${p12b64}`);
