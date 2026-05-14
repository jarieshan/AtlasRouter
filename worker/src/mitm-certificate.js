import forge from "node-forge";

const CERT_VALIDITY_YEARS = 5;
const RSA_PUBLIC_EXPONENT = new Uint8Array([0x01, 0x00, 0x01]);

export async function generateMitmCertificate(label = "AtlasRouter") {
  const safeLabel = singleLine(label).slice(0, 80) || "AtlasRouter";
  const commonName = `${safeLabel} MITM CA`;
  const passphrase = randomHex(24);
  const keys = await generateRsaKeys();
  const certificate = forge.pki.createCertificate();
  const now = new Date();

  certificate.publicKey = keys.publicKey;
  certificate.serialNumber = randomSerialNumber();
  certificate.validity.notBefore = new Date(now.getTime() - 60 * 1000);
  certificate.validity.notAfter = new Date(now);
  certificate.validity.notAfter.setFullYear(certificate.validity.notAfter.getFullYear() + CERT_VALIDITY_YEARS);

  const attributes = [
    { name: "commonName", value: commonName },
    { name: "organizationName", value: "AtlasRouter" },
  ];
  certificate.setSubject(attributes);
  certificate.setIssuer(attributes);
  certificate.setExtensions([
    { name: "basicConstraints", cA: true, critical: true },
    {
      name: "keyUsage",
      keyCertSign: true,
      cRLSign: true,
      digitalSignature: true,
      critical: true,
    },
    { name: "subjectKeyIdentifier" },
  ]);
  certificate.sign(keys.privateKey, forge.md.sha256.create());

  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, certificate, passphrase, {
    algorithm: "3des",
    friendlyName: commonName,
  });
  const p12Bytes = forge.asn1.toDer(p12).getBytes();

  return {
    enabled: true,
    hostname: "",
    caP12: forge.util.encode64(p12Bytes).replace(/\s+/g, ""),
    caPassphrase: passphrase,
    caCertificate: forge.pki.certificateToPem(certificate).trimEnd(),
  };
}

async function generateRsaKeys() {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: RSA_PUBLIC_EXPONENT,
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const [privateKeyDer, publicKeyDer] = await Promise.all([
    crypto.subtle.exportKey("pkcs8", keyPair.privateKey),
    crypto.subtle.exportKey("spki", keyPair.publicKey),
  ]);

  return {
    privateKey: forge.pki.privateKeyFromAsn1(derToAsn1(privateKeyDer)),
    publicKey: forge.pki.publicKeyFromAsn1(derToAsn1(publicKeyDer)),
  };
}

function derToAsn1(value) {
  return forge.asn1.fromDer(arrayBufferToBinary(value));
}

function arrayBufferToBinary(value) {
  const bytes = new Uint8Array(value);
  const chunkSize = 0x8000;
  let output = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    output += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return output;
}

function randomHex(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomSerialNumber() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[0] &= 0x7f;
  if (bytes.every((byte) => byte === 0)) {
    bytes[15] = 1;
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function singleLine(value) {
  return String(value ?? "").replace(/[\r\n]+/g, " ").trim();
}
