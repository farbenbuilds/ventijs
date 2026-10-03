// Adapted from `ws`'s `examples/express-session-parse` (MIT). The browser sends the session
// cookie with the WebSocket handshake, so "Simulate login" must happen before connecting.
(function () {
  const messages = document.querySelector("#messages");
  const login = document.querySelector("#login");
  const logout = document.querySelector("#logout");
  const wsButton = document.querySelector("#wsButton");
  const wsSendButton = document.querySelector("#wsSendButton");

  function showMessage(message) {
    messages.textContent += `\n${message}`;
    messages.scrollTop = messages.scrollHeight;
  }

  function handleResponse(response) {
    if (!response.ok) return Promise.reject(new Error("Unexpected response"));
    return response.json().then((data) => JSON.stringify(data, null, 2));
  }

  login.onclick = () => {
    fetch("/login", { method: "POST", credentials: "same-origin" })
      .then(handleResponse)
      .then(showMessage)
      .catch((error) => showMessage(error.message));
  };

  logout.onclick = () => {
    fetch("/logout", { method: "DELETE", credentials: "same-origin" })
      .then(handleResponse)
      .then(showMessage)
      .catch((error) => showMessage(error.message));
  };

  let socket;

  wsButton.onclick = () => {
    if (socket) {
      socket.onerror = socket.onopen = socket.onclose = null;
      socket.close();
    }

    socket = new WebSocket(`ws://${location.host}`);
    socket.onerror = () => showMessage("WebSocket error");
    socket.onopen = () => showMessage("WebSocket connection established");
    socket.onclose = () => {
      showMessage("WebSocket connection closed");
      socket = null;
    };
  };

  wsSendButton.onclick = () => {
    if (!socket) {
      showMessage("No WebSocket connection");
      return;
    }

    socket.send("Hello World!");
    showMessage('Sent "Hello World!"');
  };
})();
