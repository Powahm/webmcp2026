export function progress(label: string, every = 250_000) {
  let n = 0;
  const started = Date.now();
  return {
    tick() {
      n++;
      if (n % every === 0) {
        const secs = ((Date.now() - started) / 1000).toFixed(0);
        process.stdout.write(`\r  ${label}: ${n.toLocaleString()} rows (${secs}s)   `);
      }
    },
    done() {
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      process.stdout.write(`\r  ${label}: ${n.toLocaleString()} rows in ${secs}s        \n`);
      return n;
    },
  };
}
