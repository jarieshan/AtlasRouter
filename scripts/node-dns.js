const key = `node-dns-${$domain}`;
let pending = 2;

for (const host of ["223.5.5.5", "1.12.12.12"]) {
  $httpClient.get({ url: `https://${host}/resolve?name=${$domain}&type=1`, timeout: 2, policy: "DIRECT" }, (error, response, data) => {
    let addresses = [];
    try {
      addresses = JSON.parse(data).Answer.filter((r) => r.type === 1).map((r) => r.data);
    } catch {}
    if (addresses.length) {
      $persistentStore.write(addresses.join(","), key);
      $done({ addresses, ttl: 300 });
    } else if (--pending === 0) {
      const saved = $persistentStore.read(key);
      $done(saved ? { addresses: saved.split(",") } : { servers: ["223.5.5.5", "119.29.29.29"] });
    }
  });
}
