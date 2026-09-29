import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import tls from "node:tls";

export const EXPECTED_ROOT_FINGERPRINT =
  "D2:6D:2D:02:31:B7:C3:9F:92:CC:73:85:12:BA:54:10:35:19:E4:40:5D:68:B5:BD:70:3E:97:88:CA:8E:CF:31";

const certificateUrl = new URL(
  "../certs/russian_trusted_root_ca.pem",
  import.meta.url,
);

let configured = false;

export function readTrustedRootCertificate() {
  const pem = readFileSync(certificateUrl, "utf8");
  const certificate = new X509Certificate(pem);

  if (certificate.fingerprint256 !== EXPECTED_ROOT_FINGERPRINT) {
    throw new Error("Отпечаток корневого сертификата Минцифры не совпадает с ожидаемым");
  }

  if (!certificate.subject.includes("CN=Russian Trusted Root CA")) {
    throw new Error("Файл доверия не является Russian Trusted Root CA");
  }

  return { pem, certificate };
}

export function configureMaxApiTls() {
  if (configured) return;

  if (
    typeof tls.getCACertificates !== "function" ||
    typeof tls.setDefaultCACertificates !== "function"
  ) {
    throw new Error("Для безопасного подключения к MAX требуется Node.js 24.5 или новее");
  }

  const { pem } = readTrustedRootCertificate();
  const defaults = tls.getCACertificates("default");
  tls.setDefaultCACertificates([...defaults, pem]);
  configured = true;
}
