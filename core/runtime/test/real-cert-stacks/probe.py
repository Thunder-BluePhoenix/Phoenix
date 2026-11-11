# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Phoenix contributors
#
# One stack of core/runtime/test/real-phone-cert-stacks.test.ts: Python `cryptography` (parser) and
# Python `ssl` (OpenSSL, the TLS client). argv: host port cert.der other-cert.der right-pin wrong-pin.
# Prints one JSON object. Never touches the network beyond host:port and never uses system trust.
import hashlib
import json
import socket
import ssl
import sys
import warnings

host, port, cert_path, other_path, right_pin, wrong_pin = sys.argv[1:7]
port = int(port)
der = open(cert_path, "rb").read()
other = open(other_path, "rb").read()
out = {"stack": "python-cryptography-ssl", "warnings": []}


def fp(data):
    h = hashlib.sha256(data).hexdigest().upper()
    return ":".join(h[i : i + 2] for i in range(0, len(h), 2))


with warnings.catch_warnings(record=True) as caught:
    warnings.simplefilter("always")
    import cryptography
    from cryptography import x509
    from cryptography.hazmat.primitives.asymmetric import ec

    cert = x509.load_der_x509_certificate(der)
    out["versions"] = {"cryptography": cryptography.__version__, "openssl": ssl.OPENSSL_VERSION}
    key = cert.public_key()
    exts = []
    for e in cert.extensions:
        exts.append({"oid": e.oid.dotted_string, "name": e.oid._name, "critical": e.critical, "value": repr(e.value)})
    sans = []
    try:
        san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
        sans = [repr(g) for g in san]
    except x509.ExtensionNotFound:
        pass
    serial = cert.serial_number
    verified = None
    try:
        key.verify(cert.signature, cert.tbs_certificate_bytes, ec.ECDSA(cert.signature_hash_algorithm))
        verified = True
    except Exception as err:  # noqa: BLE001
        verified = "failed: " + repr(err)
    nb, na = cert.not_valid_before_utc, cert.not_valid_after_utc
    out["parse"] = {
        "subject": cert.subject.rfc4514_string(),
        "issuer": cert.issuer.rfc4514_string(),
        "notBefore": nb.isoformat(),
        "notAfter": na.isoformat(),
        "validityDays": (na - nb).total_seconds() / 86400,
        "version": str(cert.version),
        "keyAlgorithm": type(key).__name__,
        "curve": getattr(getattr(key, "curve", None), "name", None),
        "signatureAlgorithm": cert.signature_algorithm_oid._name,
        "signatureHash": getattr(cert.signature_hash_algorithm, "name", None),
        "serialDecimalLength": len(str(serial)),
        "serialBits": serial.bit_length(),
        "serialPositive": serial > 0,
        "extensions": exts,
        "subjectAltName": sans,
        "selfSignatureVerifies": verified,
        "fingerprintSha256": fp(cert.public_bytes(__import__("cryptography.hazmat.primitives.serialization", fromlist=["Encoding"]).Encoding.DER)),
    }
    out["warnings"] += [str(w.message) for w in caught]
out["sha256"] = fp(der)


def fetch(sock):
    sock.sendall(f"GET /phone/v1/pair/00000000000000000000000000000000 HTTP/1.1\r\nHost: {host}:{port}\r\nConnection: close\r\n\r\n".encode())
    data = b""
    while b"\r\n" not in data and len(data) < 4096:
        chunk = sock.recv(1024)
        if not chunk:
            break
        data += chunk
    line = data.split(b"\r\n", 1)[0].decode("latin1")
    parts = line.split(" ")
    return int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else None


def ctx_for(version, anchor):
    c = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    v = ssl.TLSVersion.TLSv1_2 if version == "1.2" else ssl.TLSVersion.TLSv1_3
    c.minimum_version = v
    c.maximum_version = v
    if anchor is None:  # pin by fingerprint: no chain or hostname checks, compared after the handshake
        c.check_hostname = False
        c.verify_mode = ssl.CERT_NONE
    else:  # the certificate itself is the only trust anchor; full path + IP SAN validation
        c.check_hostname = True
        c.verify_mode = ssl.CERT_REQUIRED
        c.load_verify_locations(cadata=anchor)
    return c


def attempt(mode, version, which):
    row = {"mode": mode, "tls": version, "pin": which, "ok": False, "negotiated": None, "httpStatus": None, "error": None}
    try:
        if mode == "pin-fingerprint":
            c = ctx_for(version, None)
        else:
            c = ctx_for(version, der if which == "right" else other)
        with socket.create_connection((host, port), timeout=10) as raw:
            with c.wrap_socket(raw, server_hostname=host) as tls:
                row["negotiated"] = tls.version()
                if mode == "pin-fingerprint":
                    seen = fp(tls.getpeercert(binary_form=True))
                    pin = right_pin if which == "right" else wrong_pin
                    if seen != pin:
                        row["error"] = "pin mismatch: presented " + seen
                        return row
                row["httpStatus"] = fetch(tls)
                row["ok"] = True
    except Exception as err:  # noqa: BLE001
        row["error"] = type(err).__name__ + ": " + str(err)
    return row


out["handshakes"] = [
    attempt(mode, v, which)
    for mode in ("pin-fingerprint", "trust-anchor")
    for v in ("1.2", "1.3")
    for which in ("right", "wrong")
]
print(json.dumps(out))
