# Ordbyggaren Multiplayer v45

## Fix för spelare 2
Kubnätverket är nu en egen A-Frame-komponent, helt separat från spelarpose,
frysning och rörelsekontroller.

- Fysikvärden skickar kubstatus var 100 ms.
- En ny spelare får sparad kubstatus direkt.
- Servern ber dessutom fysikvärden om ett omedelbart nytt paket när någon ansluter.
- Paketen innehåller position, rotation, hastighet och rotationshastighet.
- Spelare 2 fortsätter beräkna rörelsen mellan paketen med dead reckoning.
- Kubarna står därför inte still mellan uppdateringarna.
- Om inga paket kommer på 1,5 sekunder begär klienten nytt värdskap.
- Servern kontrollerar att värdens heartbeat verkligen är gammalt innan byte.
- Den nya värden skickar omedelbart ett första paket.

Detta är oberoende av frysstrålen och av vilken spelare som rör sig.
