# Tavla för däckverkstad

En lokal webbplats för Sundsvalls Bildemonterings däckverkstad. En dator kör den. Chrome på kundskärmen visar regnr och **när varje bil ska vara klar**. Verkstadsdatorn och kontorsdatorn öppnar disken, chatten och flyttar varje bil framåt.

Dagens bokningar kommer från **däckhotellet** — kalendern i Compilator / Klipboard Autowork som ni redan skriver ut till gänget och som A4 för hela dagen. Ladda samma lista hit i stället för (eller tillsammans med) utskriften. Kunderna ser då sitt regnr och sin bokade tid på tavlan.

Bilar på kundskärmen:

- **Idag** är dagens kalender: bokad tid, regnr och aktuell status.
- **Väntar** är bara drop-in-bilar som inte finns i kalendern ännu.
- **I verkstaden** betyder att bilen är vald och under arbete.
- **Klar** betyder att jobbet är klart. Kontoret får veta att bilen ska köras ut.
- **På väg** betyder att någon kör ut bilen till kunden.

## Kör den

Installera [Node.js 18 eller nyare](https://nodejs.org) och kör från den här mappen:

```bash
node server.js
```

Låt fönstret vara öppet. Datorn som kör den ska inte somna.

| Vem | Adress |
| --- | --- |
| Kunder | `http://localhost:8787/status` och tryck sedan F11 i Chrome |
| Ni i gänget | `http://localhost:8787/chat` |

På de andra två datorerna, använd den här datorns nätverksadress i stället för `localhost`. Chattsidan skriver ut adressen. Välj **Verkstad** på en dator och **Kontor** på den andra. Valet sparas. Om de datorerna inte kan öppna sidan, tillåt Node i brandväggen på datorn som kör servern.

Dagens bilar och chatt sparas i `data/state.json` på datorn som kör servern. Utlämnade bilar och gamla meddelanden försvinner efter 36 timmar.

Sätt `PORT` om 8787 redan används.

## Lägg in dagens kalender från däckhotellet

Ni behöver inte skriva in varje bil. På disken (`/chat`):

1. Öppna dagens kalender i Autowork (samma vy som ni skriver ut till gänget / A4).
2. Exportera eller kopiera den — CSV, utskriven dagslista, JSON eller en `.ics`-kalenderfil fungerar.
3. Använd **Ladda fil** eller klistra in texten och klicka sedan **Lägg in dagen på tavlan**.

Ett exempel finns i `examples/tirehotel-day.csv`.

Tavlan behåller bilar som redan är under arbete. Den lägger bara till saknade regnr, uppdaterar tider och tar bort väntande rader från däckhotellet som har ställts in sedan förra inläsningen.

### Automatisk synk (utan att klistra in varje dag)

Compilator/Klipboard har ett API, men de lämnar ut nyckeln. Ring support på 040-672 88 88 eller skriv till support@compilator.com och be om API-åtkomst till kalender/bokning för Sundsvalls Bildemontering (företag `3c7b3194-b05d-4bed-90a5-6211b699e571`, anläggning `1`).

Kopiera `.env.example` och starta servern med de värdena satta, **eller** be dem om ett privat ICS-flöde och sätt `TIREHOTEL_ICS_URL`. Disken visar då **Synka nu**, och servern uppdaterar dagen var femte minut.

Tills nyckeln finns är inläsning av dagens utskrift/export den direkta ersättningen för papperslappar.

## Kontrollera

```bash
npm test
```
