// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// One stack of core/runtime/test/real-phone-cert-stacks.test.ts: Java (java.security.cert +
// JSSE SSLSocket with a pinning X509TrustManager). Run as `java Probe.java host port cert.der
// other-cert.der right-pin wrong-pin`. Prints one JSON object (hand-built: no dependency).
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.*;
import java.security.cert.*;
import java.security.interfaces.ECPublicKey;
import java.util.*;
import javax.net.ssl.*;

public class Probe {
  static String fp(byte[] b) throws Exception {
    byte[] h = MessageDigest.getInstance("SHA-256").digest(b);
    StringBuilder s = new StringBuilder();
    for (int i = 0; i < h.length; i++) { if (i > 0) s.append(':'); s.append(String.format("%02X", h[i] & 0xff)); }
    return s.toString();
  }
  static String q(Object o) {
    if (o == null) return "null";
    if (o instanceof Number || o instanceof Boolean) return o.toString();
    if (o instanceof Collection) { StringBuilder s = new StringBuilder("["); boolean f = true; for (Object x : (Collection<?>) o) { if (!f) s.append(','); f = false; s.append(q(x)); } return s.append(']').toString(); }
    if (o instanceof Map) { StringBuilder s = new StringBuilder("{"); boolean f = true; for (Map.Entry<?, ?> e : ((Map<?, ?>) o).entrySet()) { if (!f) s.append(','); f = false; s.append(q(e.getKey().toString())).append(':').append(q(e.getValue())); } return s.append('}').toString(); }
    String v = o.toString(); StringBuilder s = new StringBuilder("\"");
    for (char c : v.toCharArray()) { if (c == '"' || c == '\\') s.append('\\').append(c); else if (c < 0x20) s.append(String.format("\\u%04x", (int) c)); else s.append(c); }
    return s.append('"').toString();
  }
  static String host, port, rightPin, wrongPin;
  static X509Certificate cert, other;

  static class PinTm extends X509ExtendedTrustManager {
    final String pin; PinTm(String pin) { this.pin = pin; }
    void check(X509Certificate[] c) throws CertificateException {
      try { if (c.length == 0 || !fp(c[0].getEncoded()).equals(pin)) throw new CertificateException("pin mismatch"); }
      catch (CertificateException e) { throw e; } catch (Exception e) { throw new CertificateException(e); }
    }
    public void checkServerTrusted(X509Certificate[] c, String a) throws CertificateException { check(c); }
    public void checkServerTrusted(X509Certificate[] c, String a, Socket s) throws CertificateException { check(c); }
    public void checkServerTrusted(X509Certificate[] c, String a, SSLEngine e) throws CertificateException { check(c); }
    public void checkClientTrusted(X509Certificate[] c, String a) { throw new UnsupportedOperationException(); }
    public void checkClientTrusted(X509Certificate[] c, String a, Socket s) { throw new UnsupportedOperationException(); }
    public void checkClientTrusted(X509Certificate[] c, String a, SSLEngine e) { throw new UnsupportedOperationException(); }
    public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
  }

  static Map<String, Object> attempt(String mode, String version, String which) {
    Map<String, Object> row = new LinkedHashMap<>();
    row.put("mode", mode); row.put("tls", version); row.put("pin", which); row.put("ok", false);
    try {
      SSLContext ctx = SSLContext.getInstance("TLS");
      boolean hostnameCheck = false;
      if (mode.equals("pin-fingerprint")) {
        ctx.init(null, new TrustManager[] { new PinTm(which.equals("right") ? rightPin : wrongPin) }, null);
      } else {
        KeyStore ks = KeyStore.getInstance(KeyStore.getDefaultType()); ks.load(null, null);
        ks.setCertificateEntry("anchor", which.equals("right") ? cert : other);
        TrustManagerFactory tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        tmf.init(ks); ctx.init(null, tmf.getTrustManagers(), null); hostnameCheck = true;
      }
      try (SSLSocket s = (SSLSocket) ctx.getSocketFactory().createSocket()) {
        s.connect(new InetSocketAddress(host, Integer.parseInt(port)), 10000); s.setSoTimeout(10000);
        SSLParameters p = s.getSSLParameters();
        p.setProtocols(new String[] { "TLSv" + version });
        if (hostnameCheck) p.setEndpointIdentificationAlgorithm("HTTPS");
        s.setSSLParameters(p);
        s.startHandshake();
        row.put("negotiated", s.getSession().getProtocol());
        row.put("cipher", s.getSession().getCipherSuite());
        OutputStream o = s.getOutputStream();
        o.write(("GET /phone/v1/pair/00000000000000000000000000000000 HTTP/1.1\r\nHost: " + host + ":" + port + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII)); o.flush();
        String line = new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.ISO_8859_1)).readLine();
        String[] parts = line == null ? new String[0] : line.split(" ");
        if (parts.length > 1) row.put("httpStatus", Integer.parseInt(parts[1]));
        row.put("ok", true);
      }
    } catch (Exception e) { row.put("error", e.getClass().getName() + ": " + e.getMessage()); }
    return row;
  }

  public static void main(String[] a) throws Exception {
    host = a[0]; port = a[1];
    byte[] der = Files.readAllBytes(Paths.get(a[2]));
    CertificateFactory cf = CertificateFactory.getInstance("X.509");
    cert = (X509Certificate) cf.generateCertificate(new ByteArrayInputStream(der));
    other = (X509Certificate) cf.generateCertificate(new ByteArrayInputStream(Files.readAllBytes(Paths.get(a[3]))));
    rightPin = a[4]; wrongPin = a[5];
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("stack", "java-jsse");
    out.put("versions", Map.of("java", System.getProperty("java.runtime.version"), "vendor", System.getProperty("java.vendor")));
    Map<String, Object> pr = new LinkedHashMap<>();
    pr.put("subject", cert.getSubjectX500Principal().getName()); pr.put("issuer", cert.getIssuerX500Principal().getName());
    pr.put("notBefore", cert.getNotBefore().toInstant().toString()); pr.put("notAfter", cert.getNotAfter().toInstant().toString());
    pr.put("validityDays", (cert.getNotAfter().getTime() - cert.getNotBefore().getTime()) / 86400000.0);
    pr.put("version", cert.getVersion()); pr.put("keyAlgorithm", cert.getPublicKey().getAlgorithm());
    if (cert.getPublicKey() instanceof ECPublicKey ek) pr.put("curve", ek.getParams().toString());
    pr.put("signatureAlgorithm", cert.getSigAlgName()); pr.put("serialBits", cert.getSerialNumber().bitLength());
    pr.put("serialPositive", cert.getSerialNumber().signum() > 0);
    pr.put("basicConstraints_pathLen(-1=not CA)", cert.getBasicConstraints());
    pr.put("keyUsage[digitalSignature,nonRepudiation,keyEncipherment,...]", cert.getKeyUsage() == null ? null : Arrays.toString(cert.getKeyUsage()));
    pr.put("extKeyUsage", cert.getExtendedKeyUsage());
    List<String> sans = new ArrayList<>();
    if (cert.getSubjectAlternativeNames() != null) for (List<?> n : cert.getSubjectAlternativeNames()) sans.add(n.get(0) + ":" + n.get(1));
    pr.put("subjectAltNames(type:value; 7=iPAddress)", sans);
    pr.put("criticalExtensionOIDs", cert.getCriticalExtensionOIDs()); pr.put("nonCriticalExtensionOIDs", cert.getNonCriticalExtensionOIDs());
    String selfSig; try { cert.verify(cert.getPublicKey()); selfSig = "ok"; } catch (Exception e) { selfSig = "failed: " + e; }
    pr.put("selfSignatureVerifies", selfSig);
    String valid; try { cert.checkValidity(); valid = "ok"; } catch (Exception e) { valid = "failed: " + e; }
    pr.put("checkValidityNow", valid);
    String pkix;
    try {
      PKIXParameters pp = new PKIXParameters(Set.of(new TrustAnchor(cert, null))); pp.setRevocationEnabled(false);
      CertPathValidator.getInstance("PKIX").validate(cf.generateCertPath(List.of(cert)), pp);
      pkix = "ok (the certificate as its own trust anchor)";
    } catch (Exception e) { pkix = "failed: " + e; }
    pr.put("pkixSelfAnchored", pkix);
    pr.put("fingerprintSha256", fp(cert.getEncoded()));
    out.put("parse", pr); out.put("sha256", fp(der)); out.put("warnings", List.of());
    List<Object> rows = new ArrayList<>();
    for (String mode : new String[] { "pin-fingerprint", "trust-anchor" }) for (String v : new String[] { "1.2", "1.3" }) for (String w : new String[] { "right", "wrong" }) rows.add(attempt(mode, v, w));
    out.put("handshakes", rows);
    System.out.println(q(out));
  }
}
