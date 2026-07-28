# Ordbyggaren Multiplayer v41

## Fixad bokstavsplacering
I v40 skickades ett `release-cube` redan innan klienten visste om bokstaven
skulle placeras i en ruta. Ett försenat ägarmeddelande kunde därför komma efter
den gröna placeringen och göra kuben lös igen.

I v41:
- ägarskapet släpps inte före placeringskontrollen
- en bokstav som placeras i en ruta förblir `placed`
- ägaruppdateringar får aldrig göra en placerad kub lös
- servern rensar bärarägarskap för både rätt och fel placerade kuber
- rätt grön bokstav låses omedelbart och stannar kvar
- fel röd bokstav sitter fast i exakt 500 ms innan den kan tas bort

Övrig kubsynk, stöldmekanik, frysstråle och multiplayer är oförändrade.
