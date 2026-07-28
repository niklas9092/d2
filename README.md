# Ordbyggaren Multiplayer v46

## Fix för fram-och-tillbaka-rörelse

v45 använde hastighetsprognos mellan nätpaketen. Kuben fortsatte då framåt
förbi den senaste auktoritativa positionen. När nästa paket kom drogs den
tillbaka, vilket skapade en mjuk men tydlig pendling.

v46 använder i stället:

- ingen extrapolering
- ingen dead reckoning
- dämpad interpolation direkt mot senaste serverposition
- mjuk quaternion-interpolation för rotation
- mikrosnäpp endast när felet är extremt litet
- fortsatt kubsynk var 100 ms
- mindre nätpaket utan onödig hastighetsdata

Resultatet ska vara mjuk framåtrörelse utan överskjutning och tillbakadragning.
