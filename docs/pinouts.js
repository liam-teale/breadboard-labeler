// Analog Discovery 2 / 3 pinout: the 2x15 MTE header and the colour of the flywire on each pin,
// as on Digilent's pin-out sheet. Both devices use the same header layout and the same harness.
// rows[0] is the top row of the connector as Digilent draws it (1+ 2+ GND V+ W1 GND T1 DIO 0-7),
// rows[1] the bottom row (1- 2- GND V- W2 GND T2 DIO 8-15), left to right. Wires on the bottom
// row carry a white stripe (except V-, which is plain white, and the grounds, which are black).

export const WIRE = {
  orange: '#FF9800', blue: '#2962FF', yellow: '#FFEB3B', red: '#FF3B30', white: '#FFFFFF', black: '#000000',
  gray: '#A6A6A6', pink: '#FF66CC', green: '#00C000', purple: '#8A2BE2', brown: '#8D5524',
};
const STRIPE = '#FFFFFF';
const DIO_COLOURS = ['pink', 'green', 'purple', 'brown'];

function pin(label, title, colour, striped = false) {
  return { label, title: `${title}: ${colour}${striped ? '/white' : ''} wire`, fill: WIRE[colour], stripe: striped ? STRIPE : null };
}
const gnd = () => pin('GND', 'Ground', 'black');
const dio = (n, striped) => pin(`DIO ${n}`, `Digital I/O ${n}`, DIO_COLOURS[n % 4], striped);

export const AD_PINOUT = {
  name: 'AD2 / AD3',
  rows: [
    [pin('1+', 'Scope channel 1 positive', 'orange'), pin('2+', 'Scope channel 2 positive', 'blue'), gnd(),
      pin('V+', 'Positive power supply', 'red'), pin('W1', 'Waveform generator 1', 'yellow'), gnd(),
      pin('T1', 'Trigger 1', 'gray'), ...[0, 1, 2, 3, 4, 5, 6, 7].map((n) => dio(n, false))],
    [pin('1-', 'Scope channel 1 negative', 'orange', true), pin('2-', 'Scope channel 2 negative', 'blue', true), gnd(),
      pin('V-', 'Negative power supply', 'white'), pin('W2', 'Waveform generator 2', 'yellow', true), gnd(),
      pin('T2', 'Trigger 2', 'gray', true), ...[8, 9, 10, 11, 12, 13, 14, 15].map((n) => dio(n, true))],
  ],
};
