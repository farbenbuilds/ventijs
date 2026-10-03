import { WebSocketServer } from "ventiws";

// PORT pins a known port; Bun.env is how a Bun process reads it.
const port = Number(Bun.env.PORT ?? 0);

const server = new WebSocketServer({ port });

server.on("connection", (socket) => {
  socket.on("message", (data, isBinary) => {
    socket.send(isBinary ? data : `echo: ${data.toString()}`);
  });
});

// Bun's built-in WebSocket is the client; ventiws only has to serve it.
server.on("listening", () => {
  const address = server.address();
  if (address === null || typeof address === "string") return;

  const client = new WebSocket(`ws://127.0.0.1:${address.port}`);

  client.onopen = () => client.send("hello from Bun");
  client.onmessage = (event) => {
    console.log(`client received: ${event.data}`);
    client.close();
  };
  client.onclose = () => server.close();
  client.onerror = (event) => console.error(event);
});
