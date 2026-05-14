import forge from "node-forge";

const CERT_VALIDITY_YEARS = 5;

export function generateMitmCertificate(label = "AtlasRouter") {
  const safeLabel = singleLine(label).slice(0, 80) || "AtlasRouter";
  const commonName = `${safeLabel} MITM CA`;
  const passphrase = randomHex(24);
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
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
