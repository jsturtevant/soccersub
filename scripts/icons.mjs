import sharp from 'sharp';
import { readFile } from 'node:fs/promises';

const source = await readFile(
  new URL('../public/icons/mark.svg', import.meta.url),
);
for (const [size, name] of [
  [192, 'icon-192'],
  [512, 'icon-512'],
  [180, 'apple-touch-icon'],
]) {
  await sharp(source)
    .resize(size, size)
    .png()
    .toFile(new URL(`../public/icons/${name}.png`, import.meta.url).pathname);
}
