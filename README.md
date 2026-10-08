# Tire workshop board

A local website for a tire workshop. One computer runs it. Chrome on the customer monitor shows the board full screen. The workshop computer and the office computer open the desk, chat, and move each car along.

Cars on the customer screen:

- **Waiting** stays in a small row.
- **In the workshop** means that car is selected and being worked on.
- **Ready** means it is done. The office is told to drive it out.
- **On the way** means someone is bringing it out to the customer.

## Run it

Install [Node.js 18 or newer](https://nodejs.org), then from this folder:

```bash
node server.js
```

Leave that window open. The computer running it should stay awake.

| Who | Address |
| --- | --- |
| Customers | `http://localhost:8787/status` then press F11 in Chrome |
| You and the crew | `http://localhost:8787/chat` |

On the other two computers, use this computer’s network address instead of `localhost`. The chat page prints that address. Pick **Workshop** on one computer and **Office** on the other. That choice is remembered. If those computers cannot open the page, allow Node through the firewall on the computer that runs the server.

The day’s cars and chat are saved in `data/state.json` on the computer running the server. Handed-over cars and old messages drop off after 36 hours.

Set `PORT` if 8787 is already in use.

## Check

```bash
npm test
```
