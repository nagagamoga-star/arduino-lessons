# Pin by Pin

16 Arduino lessons with a simulated Uno-style board you program in the browser. No hardware or install needed.

Live site: https://nagagamoga-star.github.io/arduino-lessons/

## What's inside

- Lessons from blinking an LED through PWM, buttons, sensors, servos, motors and steppers, to an LCD plant monitor and a parking sensor.
- Editable sketches that run on a simulated board, with a serial monitor.
- Progress and your code edits are saved in your own browser.

The whole site is one file, `index.html`. Open it directly or serve it with GitHub Pages.

The simulator runs a beginner-sized subset of Arduino C++, so timing is approximate. Check each part's datasheet before wiring real hardware.

## Tests

`npm test` serves this folder and runs every starter sketch in headless Chrome. That needs the dev dependency in `package.json`. The site itself is still `index.html`, and GitHub Pages does not run a build.

## Licence

MIT, copyright 2026 Naga Gamoga. See [LICENSE](LICENSE).
