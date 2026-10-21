// Mirrors index.html's `cdn.tailwindcss.com?plugins=typography` (default theme,
// typography plugin) as a static build: the recording sandbox cannot reach the
// Play CDN, so the recorder serves this compiled sheet in its place.
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
module.exports = {
    content: [
        `${root}/index.html`,
        `${root}/{App,index}.tsx`,
        `${root}/{components,pages,lib,hooks,src,services,shared,constants}/**/*.{ts,tsx,js,jsx,mjs}`,
    ],
    plugins: [require('@tailwindcss/typography')],
};
