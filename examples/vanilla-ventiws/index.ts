import { WebSocket, WebSocketServer } from "ventiws";

// PORT pins a known port; port 0 asks the OS for a free one.
const port = Number(process.env.PORT ?? 0);

const server = new WebSocketServer({ port });

server.on("connection", (socket) => {
  socket.on("message", (data, isBinary) => {
    socket.send(isBinary ? data : `echo: ${data.toString()}`);
  });
});

// The client connects once the server reports the port it actually bound.
server.on("listening", () => {
  const address = server.address();
  if (address === null || typeof address === "string") return;

  const client = new WebSocket(`ws://127.0.0.1:${address.port}`);

  client.on("open", () => client.send("hello from Node"));
  client.on("message", (data) => {
    console.log(`client received: ${data.toString()}`);
    client.close();
  });
  client.on("close", () => server.close());
  client.on("error", (error) => console.error(error));
});
