// Synthetic clients shared by the protocol-pairing tests.
export function protocolNodes(count = 3) {
  return ["vmess", "vless"].flatMap((protocol) => Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    const id = `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
    const name = `🇭🇰 ${protocol === "vmess" ? "HK" : "HongKong"}-ISP-${number}`;
    const settings = protocol === "vmess" ? "vmess-aead=true, tls=true"
      : `flow=xtls-rprx-vision, sni=target.example.com, reality-public-key=${Buffer.alloc(32, number).toString("base64url")}, reality-short-id=0123456789abcdef`;
    return {
      id: `${protocol}-${number}`, enabled: true,
      line: `${name} = ${protocol}, node.example.com, ${protocol === "vmess" ? 443 : 8443}, username=${id}, ${settings}`,
    };
  }));
}
