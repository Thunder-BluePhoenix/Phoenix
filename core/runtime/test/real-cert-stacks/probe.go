// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// One stack of core/runtime/test/real-phone-cert-stacks.test.ts: Go crypto/x509 + crypto/tls
// (standard library only). argv: host port cert.der other-cert.der right-pin wrong-pin.
package main

import (
	"bufio"
	"crypto/ecdsa"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"runtime"
	"strconv"
	"strings"
	"time"
)

func fp(b []byte) string {
	h := sha256.Sum256(b)
	s := strings.ToUpper(hex.EncodeToString(h[:]))
	parts := make([]string, 0, 32)
	for i := 0; i < len(s); i += 2 {
		parts = append(parts, s[i:i+2])
	}
	return strings.Join(parts, ":")
}

func main() {
	host, port := os.Args[1], os.Args[2]
	der, _ := os.ReadFile(os.Args[3])
	otherDer, _ := os.ReadFile(os.Args[4])
	rightPin, wrongPin := os.Args[5], os.Args[6]
	out := map[string]any{"stack": "go-crypto-x509-tls", "versions": map[string]string{"go": runtime.Version()}, "warnings": []string{}}

	cert, err := x509.ParseCertificate(der)
	if err != nil {
		out["parseError"] = err.Error()
		emit(out)
		return
	}
	exts := []map[string]any{}
	for _, e := range cert.Extensions {
		exts = append(exts, map[string]any{"oid": e.Id.String(), "critical": e.Critical})
	}
	curve := ""
	if k, ok := cert.PublicKey.(*ecdsa.PublicKey); ok {
		curve = k.Curve.Params().Name
	}
	ips := []string{}
	for _, ip := range cert.IPAddresses {
		ips = append(ips, ip.String())
	}
	pool := x509.NewCertPool()
	pool.AddCert(cert)
	_, verifyErr := cert.Verify(x509.VerifyOptions{Roots: pool, DNSName: "127.0.0.1", KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}, CurrentTime: time.Now()})
	verifyMsg := "ok"
	if verifyErr != nil {
		verifyMsg = verifyErr.Error()
	}
	selfSig := ""
	if e := cert.CheckSignature(cert.SignatureAlgorithm, cert.RawTBSCertificate, cert.Signature); e != nil {
		selfSig = "CheckSignature: " + e.Error()
	} else {
		selfSig = "ok (CheckSignature over RawTBSCertificate with its own key)"
	}
	ku := []string{}
	for name, bit := range map[string]x509.KeyUsage{"digitalSignature": x509.KeyUsageDigitalSignature, "keyEncipherment": x509.KeyUsageKeyEncipherment, "certSign": x509.KeyUsageCertSign} {
		if cert.KeyUsage&bit != 0 {
			ku = append(ku, name)
		}
	}
	eku := []string{}
	for _, u := range cert.ExtKeyUsage {
		if u == x509.ExtKeyUsageServerAuth {
			eku = append(eku, "serverAuth")
		} else {
			eku = append(eku, strconv.Itoa(int(u)))
		}
	}
	out["parse"] = map[string]any{
		"subject":                cert.Subject.String(),
		"issuer":                 cert.Issuer.String(),
		"notBefore":              cert.NotBefore.UTC().Format(time.RFC3339),
		"notAfter":               cert.NotAfter.UTC().Format(time.RFC3339),
		"validityDays":           cert.NotAfter.Sub(cert.NotBefore).Hours() / 24,
		"version":                cert.Version,
		"keyAlgorithm":           cert.PublicKeyAlgorithm.String(),
		"curve":                  curve,
		"signatureAlgorithm":     cert.SignatureAlgorithm.String(),
		"serialBits":             cert.SerialNumber.BitLen(),
		"serialPositive":         cert.SerialNumber.Sign() > 0,
		"extensions":             exts,
		"basicConstraintsValid":  cert.BasicConstraintsValid,
		"isCA":                   cert.IsCA,
		"keyUsage":               ku,
		"extKeyUsage":            eku,
		"subjectAltNameIPs":      ips,
		"subjectAltNameDNS":      cert.DNSNames,
		"unhandledCriticalExts":  len(cert.UnhandledCriticalExtensions),
		"selfSignatureVerifies":  selfSig,
		"verifyAsOwnRootForIP":   verifyMsg,
		"fingerprintSha256":      fp(cert.Raw),
	}
	out["sha256"] = fp(der)

	addr := net.JoinHostPort(host, port)
	versions := map[string]uint16{"1.2": tls.VersionTLS12, "1.3": tls.VersionTLS13}
	rows := []map[string]any{}
	for _, mode := range []string{"pin-fingerprint", "trust-anchor"} {
		for _, v := range []string{"1.2", "1.3"} {
			for _, which := range []string{"right", "wrong"} {
				row := map[string]any{"mode": mode, "tls": v, "pin": which, "ok": false, "negotiated": nil, "httpStatus": nil, "error": nil}
				cfg := &tls.Config{MinVersion: versions[v], MaxVersion: versions[v], ServerName: host}
				if mode == "pin-fingerprint" {
					want := rightPin
					if which == "wrong" {
						want = wrongPin
					}
					cfg.InsecureSkipVerify = true // system trust off: the only check is the pin below
					cfg.VerifyPeerCertificate = func(raw [][]byte, _ [][]*x509.Certificate) error {
						if len(raw) == 0 || fp(raw[0]) != want {
							return fmt.Errorf("pin mismatch")
						}
						return nil
					}
				} else {
					p := x509.NewCertPool()
					if which == "right" {
						p.AddCert(cert)
					} else if oc, e := x509.ParseCertificate(otherDer); e == nil {
						p.AddCert(oc)
					}
					cfg.RootCAs = p
				}
				d := net.Dialer{Timeout: 10 * time.Second}
				conn, e := tls.DialWithDialer(&d, "tcp", addr, cfg)
				if e != nil {
					row["error"] = e.Error()
				} else {
					row["negotiated"] = tls.VersionName(conn.ConnectionState().Version)
					conn.SetDeadline(time.Now().Add(10 * time.Second))
					fmt.Fprintf(conn, "GET /phone/v1/pair/00000000000000000000000000000000 HTTP/1.1\r\nHost: %s\r\nConnection: close\r\n\r\n", addr)
					line, _ := bufio.NewReader(conn).ReadString('\n')
					f := strings.Fields(line)
					if len(f) > 1 {
						if n, e := strconv.Atoi(f[1]); e == nil {
							row["httpStatus"] = n
						}
					}
					row["ok"] = true
					conn.Close()
				}
				rows = append(rows, row)
			}
		}
	}
	out["handshakes"] = rows
	emit(out)
}

func emit(v any) {
	b, _ := json.Marshal(v)
	fmt.Println(string(b))
}
