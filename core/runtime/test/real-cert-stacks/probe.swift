// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// One stack of core/runtime/test/real-phone-cert-stacks.test.ts: Apple's Security framework
// (SecCertificate, SecTrust) and Foundation's URLSession with a delegate that pins the SHA-256
// fingerprint. argv: host port cert.der other-cert.der right-pin wrong-pin. Prints one JSON object.
// macOS only: this is the same family iOS uses, not iOS.
import CryptoKit
import Foundation
import Security

let args = CommandLine.arguments
let host = args[1]
let port = args[2]
let der = try! Data(contentsOf: URL(fileURLWithPath: args[3]))
let otherDer = try! Data(contentsOf: URL(fileURLWithPath: args[4]))
let rightPin = args[5]
let wrongPin = args[6]

func fp(_ d: Data) -> String {
    SHA256.hash(data: d).map { String(format: "%02X", $0) }.joined(separator: ":")
}

var out: [String: Any] = ["stack": "apple-security-urlsession", "warnings": [String]()]
let os = ProcessInfo.processInfo.operatingSystemVersionString
out["versions"] = ["macOS": os]

guard let cert = SecCertificateCreateWithData(nil, der as CFData) else {
    out["parseError"] = "SecCertificateCreateWithData returned nil"
    print(String(data: try! JSONSerialization.data(withJSONObject: out), encoding: .utf8)!)
    exit(0)
}
let otherCert = SecCertificateCreateWithData(nil, otherDer as CFData)!

func summarise(_ v: Any?) -> String {
    guard let v = v else { return "nil" }
    return String(describing: v).replacingOccurrences(of: "\n", with: " ")
}

var parse: [String: Any] = [:]
parse["subjectSummary"] = SecCertificateCopySubjectSummary(cert) as String? ?? ""
parse["fingerprintSha256"] = fp(SecCertificateCopyData(cert) as Data)
var serialErr: Unmanaged<CFError>?
if let s = SecCertificateCopySerialNumberData(cert, &serialErr) as Data? {
    parse["serialBytes"] = s.count
    parse["serialTopBitClear"] = (s.first ?? 0) & 0x80 == 0
}
if let key = SecCertificateCopyKey(cert), let attrs = SecKeyCopyAttributes(key) as? [String: Any] {
    parse["keyType"] = summarise(attrs[kSecAttrKeyType as String])
    parse["keySizeBits"] = attrs[kSecAttrKeySizeInBits as String] ?? NSNull()
    parse["keyIsECSECPrimeRandom"] = (attrs[kSecAttrKeyType as String] as? String) == (kSecAttrKeyTypeECSECPrimeRandom as String)
}
if let ips = SecCertificateCopyNormalizedSubjectSequence(cert) { parse["normalizedSubjectBytes"] = (ips as Data).count }
var vals: [String: Any] = [:]
if let dict = SecCertificateCopyValues(cert, nil, nil) as? [String: Any] {
    for (k, v) in dict {
        if let d = v as? [String: Any] {
            vals[k] = ["label": summarise(d["label"]), "value": summarise(d["value"]), "type": summarise(d["type"])]
        }
    }
}
parse["values"] = vals
out["parse"] = parse

// SecTrust evaluation of the certificate as its own (only) anchor, SSL policy for the IP.
func evaluate(_ target: SecCertificate, anchor: SecCertificate, name: String?, checkDate: Date? = nil) -> [String: Any] {
    var trust: SecTrust?
    let policy = SecPolicyCreateSSL(true, name as CFString?)
    var r: [String: Any] = [:]
    let st = SecTrustCreateWithCertificates(target, policy, &trust)
    guard st == errSecSuccess, let t = trust else { return ["error": "SecTrustCreateWithCertificates \(st)"] }
    SecTrustSetAnchorCertificates(t, [anchor] as CFArray)
    SecTrustSetAnchorCertificatesOnly(t, true)
    if let d = checkDate { SecTrustSetVerifyDate(t, d as CFDate) }
    var err: CFError?
    let ok = SecTrustEvaluateWithError(t, &err)
    r["trusted"] = ok
    if let e = err { r["error"] = (e as Error).localizedDescription + " [\(CFErrorGetCode(e))]" }
    if let props = SecTrustCopyResult(t) as? [String: Any] { r["result"] = summarise(props) }
    return r
}
var trustRows: [String: Any] = [:]
trustRows["selfAsAnchor_sslPolicy_ipHostname"] = evaluate(cert, anchor: cert, name: host)
trustRows["selfAsAnchor_sslPolicy_noHostname"] = evaluate(cert, anchor: cert, name: nil)
trustRows["selfAsAnchor_sslPolicy_wrongHostname"] = evaluate(cert, anchor: cert, name: "192.0.2.77")
trustRows["otherCertAsAnchor_sslPolicy_ipHostname"] = evaluate(cert, anchor: otherCert, name: host)
trustRows["selfAsAnchor_sslPolicy_ipHostname_in_400_days"] = evaluate(cert, anchor: cert, name: host, checkDate: Date().addingTimeInterval(400 * 86400))
out["secTrust"] = trustRows

// URLSession handshakes.
final class Delegate: NSObject, URLSessionDelegate {
    let mode: String
    let pin: String
    let anchor: SecCertificate
    var presented = ""
    var trustResult: [String: Any] = [:]
    init(mode: String, pin: String, anchor: SecCertificate) { self.mode = mode; self.pin = pin; self.anchor = anchor }
    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let trust = challenge.protectionSpace.serverTrust,
              let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate], let leaf = chain.first
        else { completionHandler(.cancelAuthenticationChallenge, nil); return }
        presented = fp(SecCertificateCopyData(leaf) as Data)
        if mode == "pin-fingerprint" {
            // System trust is NOT consulted: only the pin decides.
            if presented == pin { completionHandler(.useCredential, URLCredential(trust: trust)) }
            else { completionHandler(.cancelAuthenticationChallenge, nil) }
        } else {
            // The given certificate is the only anchor; hostname policy comes from the challenge.
            SecTrustSetAnchorCertificates(trust, [anchor] as CFArray)
            SecTrustSetAnchorCertificatesOnly(trust, true)
            var err: CFError?
            if SecTrustEvaluateWithError(trust, &err) { completionHandler(.useCredential, URLCredential(trust: trust)) }
            else {
                trustResult["error"] = err.map { ($0 as Error).localizedDescription } ?? "unknown"
                completionHandler(.cancelAuthenticationChallenge, nil)
            }
        }
    }
}

func attempt(_ mode: String, _ version: String, _ which: String) -> [String: Any] {
    var row: [String: Any] = ["mode": mode, "tls": version, "pin": which, "ok": false]
    let cfg = URLSessionConfiguration.ephemeral
    let v: tls_protocol_version_t = version == "1.2" ? .TLSv12 : .TLSv13
    cfg.tlsMinimumSupportedProtocolVersion = v
    cfg.tlsMaximumSupportedProtocolVersion = v
    cfg.timeoutIntervalForRequest = 10
    cfg.urlCache = nil
    cfg.requestCachePolicy = .reloadIgnoringLocalCacheData
    let delegate = Delegate(mode: mode, pin: mode == "pin-fingerprint" ? (which == "right" ? rightPin : wrongPin) : which, anchor: which == "right" ? cert : otherCert)
    let session = URLSession(configuration: cfg, delegate: delegate, delegateQueue: nil)
    let sem = DispatchSemaphore(value: 0)
    var req = URLRequest(url: URL(string: "https://\(host):\(port)/phone/v1/pair/00000000000000000000000000000000")!)
    req.httpMethod = "GET"
    session.dataTask(with: req) { _, resp, err in
        if let http = resp as? HTTPURLResponse { row["httpStatus"] = http.statusCode; row["ok"] = true }
        if let e = err { row["error"] = "\((e as NSError).domain) \((e as NSError).code): \(e.localizedDescription)" }
        sem.signal()
    }.resume()
    if sem.wait(timeout: .now() + 20) == .timedOut { row["error"] = "timeout" }
    session.invalidateAndCancel()
    row["presented"] = delegate.presented
    if let te = delegate.trustResult["error"] { row["trustError"] = te }
    return row
}
var rows: [[String: Any]] = []
for mode in ["pin-fingerprint", "trust-anchor"] {
    for v in ["1.2", "1.3"] { for w in ["right", "wrong"] { rows.append(attempt(mode, v, w)) } }
}
out["handshakes"] = rows
print(String(data: try! JSONSerialization.data(withJSONObject: out, options: [.sortedKeys]), encoding: .utf8)!)
