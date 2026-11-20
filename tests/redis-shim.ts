// Test harness: a real redis-server plus a tiny HTTP shim that speaks Upstash's REST protocol
// (POST a JSON array command, get { result } back). Lets us run the Lua scripts for real.

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import http from "node:http";
import net from "node:net";

export const hasRedisServer = spawnSync("redis-server", ["--version"]).status === 0;

type Reply = string | number | null | Reply[] | Error;

function parseReply(buf: Buffer, at: number): [Reply, number] | null {
  if (at >= buf.length) return null;
  const nl = buf.indexOf("\r\n", at);
  if (nl < 0) return null;
  const type = String.fromCharCode(buf[at]!);
  const line = buf.toString("utf8", at + 1, nl);
  const next = nl + 2;
  switch (type) {
    case "+":
      return [line, next];
    case "-":
      return [new Error(line), next];
    case ":":
      return [Number(line), next];
    case "$": {
      const len = Number(line);
      if (len < 0) return [null, next];
      if (buf.length < next + len + 2) return null;
      return [buf.toString("utf8", next, next + len), next + len + 2];
    }
    case "*": {
      const n = Number(line);
      if (n < 0) return [null, next];
      const items: Reply[] = [];
      let pos = next;
      for (let i = 0; i < n; i++) {
        const r = parseReply(buf, pos);
        if (!r) return null;
        items.push(r[0]);
        pos = r[1];
      }
      return [items, pos];
    }
    default:
      throw new Error(`bad RESP type ${type}`);
  }
}

export class Resp {
  private buf = Buffer.alloc(0);
  private waiting: ((r: Reply) => void)[] = [];
  private constructor(private sock: net.Socket) {
    sock.on("data", (d) => {
      this.buf = Buffer.concat([this.buf, d]);
      for (;;) {
        const r = parseReply(this.buf, 0);
        if (!r) break;
        this.buf = this.buf.subarray(r[1]);
        this.waiting.shift()?.(r[0]);
      }
    });
  }
  static connect(port: number): Promise<Resp> {
    return new Promise((resolve, reject) => {
      const sock = net.connect(port, "127.0.0.1", () => resolve(new Resp(sock)));
      sock.on("error", reject);
    });
  }
  command(args: string[]): Promise<Reply> {
    const payload = `*${args.length}\r\n` + args.map((a) => `$${Buffer.byteLength(a)}\r\n${a}\r\n`).join("");
    return new Promise((resolve) => {
      this.waiting.push(resolve);
      this.sock.write(payload);
    });
  }
  close() {
    this.sock.destroy();
  }
}

export interface RedisHarness {
  url: string;
  token: string;
  resp: Resp;
  /** Commands the shim has forwarded (to count how many commands a scenario costs). */
  commands: string[][];
  stop(): Promise<void>;
}

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = net.createServer().listen(0, () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });

export async function startRedis(): Promise<RedisHarness> {
  const port = await freePort();
  const proc: ChildProcess = spawn("redis-server", ["--port", String(port), "--save", "", "--appendonly", "no", "--bind", "127.0.0.1"], { stdio: "ignore" });
  let resp: Resp | undefined;
  for (let i = 0; i < 50 && !resp; i++) {
    try {
      resp = await Resp.connect(port);
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  if (!resp) throw new Error("redis-server did not start");
  const client = resp;
  const commands: string[][] = [];

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", async () => {
      if (req.headers.authorization !== "Bearer test-token") {
        res.writeHead(401).end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
      const cmd = (JSON.parse(body) as unknown[]).map(String);
      commands.push(cmd);
      const r = await client.command(cmd);
      if (r instanceof Error) res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: r.message }));
      else res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ result: r }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const httpPort = (server.address() as net.AddressInfo).port;

  return {
    url: `http://127.0.0.1:${httpPort}`,
    token: "test-token",
    resp: client,
    commands,
    async stop() {
      client.close();
      server.close();
      proc.kill();
    },
  };
}
