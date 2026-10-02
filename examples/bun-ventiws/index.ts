import { WebSocket, WebSocketServer } from "ventiws";

// Port 0 binds an ephemeral port, so the example can run repeatedly.
const server = new WebSocketServer({ port: 0 });

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

  client.on("open", () => client.send("hello from the client"));
  client.on("message", (data) => {
    console.log(`client received: ${data.toString()}`);
    client.close();
  });
  client.on("close", () => server.close());
  client.on("error", (error) => console.error(error));
});
