"use strict";
function encodeMessage(value) {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

// Native messages are a 4-byte little-endian length followed by UTF-8 JSON.
function createMessageReader(onMessage) {
  let buffer = Buffer.alloc(0);

  return (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE(0);

      if (buffer.length < 4 + length) {
        return;
      }

      const body = buffer.subarray(4, 4 + length).toString("utf8");
      buffer = buffer.subarray(4 + length);
      onMessage(JSON.parse(body));
    }
  };
}

function serve(run, ping) {
  const children = new Set();
  let pending = 0;
  let closed = false;

  const send = (value) => process.stdout.write(encodeMessage(value));
  const exitWhenIdle = () => {
    if (closed && pending === 0) {
      process.exit(0);
    }
  };

  const read = createMessageReader(async (request) => {
    if (request?.type === "ping") {
      send({ ok: true, ...ping });
      return;
    }

    pending += 1;
    let reply;
    try {
      reply = await run(request, {
        onChild: (child) => {
          children.add(child);
          child.on("close", () => children.delete(child));
        },
      });
    } catch (error) {
      reply = { ok: false, error: error.message };
    } finally {
      pending -= 1;
    }

    if (!closed) {
      send(reply);
    }

    exitWhenIdle();
  });

  process.stdin.on("data", (chunk) => {
    try {
      read(chunk);
    } catch (error) {
      send({ ok: false, error: `Bad message: ${error.message}` });
    }
  });

  // Chrome closes stdin when the extension disconnects: stop any run in flight.
  process.stdin.on("end", () => {
    closed = true;
    children.forEach((child) => child.kill("SIGTERM"));
    exitWhenIdle();
  });
}

module.exports = { encodeMessage, createMessageReader, serve };
