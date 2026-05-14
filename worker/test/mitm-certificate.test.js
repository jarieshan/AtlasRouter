import assert from "node:assert/strict";
import test from "node:test";

import forge from "node-forge";

import { generateMitmCertificate } from "../src/mitm-certificate.js";

test("generates a parseable MitM CA p12", async () => {
  const mitm = await generateMitmCertificate("Primary");
  const p12Asn1 = forge.asn1.fromDer(forge.util.decode64(mitm.caP12));
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, mitm.caPassphrase);
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag];
  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag];
  const cert = certBags[0].cert;

  assert.equal(mitm.enabled, true);
  assert.equal(mitm.hostname, "");
  assert.equal(mitm.caPassphrase.length, 48);
  assert.equal(keyBags.length, 1);
  assert.equal(certBags.length, 1);
  assert.equal(cert.subject.getField("CN").value, "Primary MITM CA");
  assert.equal(cert.isIssuer(cert), true);
  assert.equal(cert.verify(cert), true);
});
