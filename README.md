# Tire workshop board

A local website for Sundsvalls Bildemontering’s däckverkstad. One computer runs it. Chrome on the customer monitor shows plates and **when each car should be ready**. The workshop computer and the office computer open the desk, chat, and move each car along.

The day’s bookings come from **Tirehotel** — the Compilator / Klipboard Autowork calendar you already print for the crew and as an A4 for the whole day. Load that same list into this app instead of (or as well as) printing it. Customers then see their plate and booked time on the board.

Cars on the customer screen:

- **Today** is the day’s calendar: booked time, plate, and live status.
- **Waiting** is only drop-in cars that are not on the calendar yet.
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

## Put today’s Tirehotel calendar on the board

You do not need to type every car. On the desk (`/chat`):

1. In Autowork, open today’s calendar (the same view you print for the crew / A4).
2. Export or copy it — CSV, the printed day list, JSON, or an `.ics` calendar file all work.
3. Use **Load file** or paste the text, then **Put today on the board**.

A sample file lives in `examples/tirehotel-day.csv`.

The board keeps cars that are already being worked on. It only adds missing plates, refreshes times, and drops waiting Tirehotel rows that were cancelled since the last load.

### Automatic sync (no daily paste)

Compilator/Klipboard has an API, but they hand out the key. Call support on 040-672 88 88 or support@compilator.com and ask for calendar/booking API access for Sundsvalls Bildemontering (company `3c7b3194-b05d-4bed-90a5-6211b699e571`, branch `1`).

Copy `.env.example` and start the server with those values set, **or** ask them for a private ICS feed and set `TIREHOTEL_ICS_URL`. The desk then shows **Sync now**, and the server refreshes the day every five minutes.

Until that key exists, loading the daily print/export is the direct replacement for handing out paper.

## Check

```bash
npm test
```
