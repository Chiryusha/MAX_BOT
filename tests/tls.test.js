import test from "node:test";
import assert from "node:assert/strict";
import {
  EXPECTED_ROOT_FINGERPRINT,
  readTrustedRootCertificate,
} from "../src/tls.js";

test("bundled Ministry root certificate has the pinned fingerprint", () => {
  const { certificate } = readTrustedRootCertificate();
  assert.equal(certificate.fingerprint256, EXPECTED_ROOT_FINGERPRINT);
  assert.match(certificate.subject, /CN=Russian Trusted Root CA/);
});
