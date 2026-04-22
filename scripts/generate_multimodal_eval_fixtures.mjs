#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'multimodal-fixtures');

const fixtures = [
  {
    filename: 'city-skyline-night.png',
    width: 1280,
    height: 720,
    svg: `
      <svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
        <defs>
          <linearGradient id="nightSky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#071229" />
            <stop offset="65%" stop-color="#18345c" />
            <stop offset="100%" stop-color="#244770" />
          </linearGradient>
        </defs>
        <rect width="1280" height="720" fill="url(#nightSky)" />
        <rect y="520" width="1280" height="200" fill="#0d1624" />
        <circle cx="1110" cy="92" r="42" fill="#f5edc8" opacity="0.92" />
        <g fill="#131d2b">
          <rect x="60" y="260" width="150" height="260" rx="4" />
          <rect x="220" y="180" width="110" height="340" rx="4" />
          <rect x="345" y="120" width="96" height="400" rx="4" />
          <rect x="452" y="240" width="130" height="280" rx="4" />
          <rect x="598" y="150" width="102" height="370" rx="4" />
          <rect x="714" y="100" width="88" height="420" rx="4" />
          <rect x="812" y="205" width="144" height="315" rx="4" />
          <rect x="968" y="170" width="110" height="350" rx="4" />
          <rect x="1092" y="230" width="128" height="290" rx="4" />
        </g>
        <g fill="#f7cf66" opacity="0.95">
          <rect x="82" y="288" width="18" height="18" />
          <rect x="118" y="288" width="18" height="18" />
          <rect x="154" y="288" width="18" height="18" />
          <rect x="82" y="326" width="18" height="18" />
          <rect x="118" y="326" width="18" height="18" />
          <rect x="154" y="326" width="18" height="18" />
          <rect x="246" y="210" width="18" height="18" />
          <rect x="282" y="210" width="18" height="18" />
          <rect x="246" y="246" width="18" height="18" />
          <rect x="282" y="246" width="18" height="18" />
          <rect x="364" y="150" width="16" height="16" />
          <rect x="396" y="150" width="16" height="16" />
          <rect x="364" y="182" width="16" height="16" />
          <rect x="396" y="182" width="16" height="16" />
          <rect x="476" y="268" width="18" height="18" />
          <rect x="512" y="268" width="18" height="18" />
          <rect x="624" y="184" width="18" height="18" />
          <rect x="660" y="184" width="18" height="18" />
          <rect x="736" y="134" width="16" height="16" />
          <rect x="766" y="134" width="16" height="16" />
          <rect x="736" y="166" width="16" height="16" />
          <rect x="766" y="166" width="16" height="16" />
          <rect x="846" y="239" width="18" height="18" />
          <rect x="882" y="239" width="18" height="18" />
          <rect x="994" y="198" width="18" height="18" />
          <rect x="1030" y="198" width="18" height="18" />
          <rect x="1120" y="258" width="18" height="18" />
          <rect x="1156" y="258" width="18" height="18" />
        </g>
        <rect y="540" width="1280" height="180" fill="#0a121d" opacity="0.76" />
      </svg>`,
  },
  {
    filename: 'city-skyline-day.png',
    width: 1280,
    height: 720,
    svg: `
      <svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
        <defs>
          <linearGradient id="daySky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#8fd6ff" />
            <stop offset="70%" stop-color="#d7efff" />
            <stop offset="100%" stop-color="#eef7ff" />
          </linearGradient>
        </defs>
        <rect width="1280" height="720" fill="url(#daySky)" />
        <circle cx="1080" cy="110" r="56" fill="#fff2a8" />
        <rect y="555" width="1280" height="165" fill="#7a8c97" />
        <g fill="#6e7f89">
          <rect x="70" y="255" width="160" height="300" rx="4" />
          <rect x="246" y="190" width="122" height="365" rx="4" />
          <rect x="382" y="145" width="110" height="410" rx="4" />
          <rect x="506" y="230" width="150" height="325" rx="4" />
          <rect x="676" y="165" width="118" height="390" rx="4" />
          <rect x="808" y="120" width="96" height="435" rx="4" />
          <rect x="922" y="214" width="138" height="341" rx="4" />
          <rect x="1072" y="180" width="118" height="375" rx="4" />
        </g>
        <g fill="#dbe7ef">
          <rect x="98" y="286" width="20" height="20" />
          <rect x="138" y="286" width="20" height="20" />
          <rect x="98" y="326" width="20" height="20" />
          <rect x="138" y="326" width="20" height="20" />
          <rect x="272" y="220" width="18" height="18" />
          <rect x="306" y="220" width="18" height="18" />
          <rect x="412" y="180" width="18" height="18" />
          <rect x="444" y="180" width="18" height="18" />
          <rect x="538" y="266" width="18" height="18" />
          <rect x="572" y="266" width="18" height="18" />
          <rect x="708" y="204" width="18" height="18" />
          <rect x="742" y="204" width="18" height="18" />
          <rect x="834" y="160" width="18" height="18" />
          <rect x="864" y="160" width="18" height="18" />
          <rect x="956" y="246" width="18" height="18" />
          <rect x="990" y="246" width="18" height="18" />
        </g>
      </svg>`,
  },
  {
    filename: 'growth-line-chart.png',
    width: 1280,
    height: 720,
    svg: `
      <svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
        <rect width="1280" height="720" fill="#f7fafc" />
        <text x="100" y="110" font-family="Helvetica, Arial, sans-serif" font-size="46" font-weight="700" fill="#153047">Monthly Growth</text>
        <text x="100" y="156" font-family="Helvetica, Arial, sans-serif" font-size="24" fill="#587189">Units sold</text>
        <g stroke="#d8e1ea" stroke-width="2">
          <line x1="140" y1="200" x2="140" y2="600" />
          <line x1="140" y1="600" x2="1140" y2="600" />
          <line x1="140" y1="520" x2="1140" y2="520" />
          <line x1="140" y1="440" x2="1140" y2="440" />
          <line x1="140" y1="360" x2="1140" y2="360" />
          <line x1="140" y1="280" x2="1140" y2="280" />
        </g>
        <g font-family="Helvetica, Arial, sans-serif" font-size="22" fill="#5f7384">
          <text x="102" y="608">0</text>
          <text x="84" y="528">25</text>
          <text x="84" y="448">50</text>
          <text x="84" y="368">75</text>
          <text x="72" y="288">100</text>
          <text x="172" y="646">Jan</text>
          <text x="334" y="646">Feb</text>
          <text x="496" y="646">Mar</text>
          <text x="658" y="646">Apr</text>
          <text x="820" y="646">May</text>
          <text x="982" y="646">Jun</text>
        </g>
        <polyline fill="none" stroke="#0f8fda" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"
          points="190,544 352,500 514,456 676,388 838,320 1000,246" />
        <g fill="#0f8fda">
          <circle cx="190" cy="544" r="10" />
          <circle cx="352" cy="500" r="10" />
          <circle cx="514" cy="456" r="10" />
          <circle cx="676" cy="388" r="10" />
          <circle cx="838" cy="320" r="10" />
          <circle cx="1000" cy="246" r="10" />
        </g>
      </svg>`,
  },
  {
    filename: 'historical-document.png',
    width: 1100,
    height: 1400,
    svg: `
      <svg xmlns="http://www.w3.org/2000/svg" width="1100" height="1400" viewBox="0 0 1100 1400">
        <rect width="1100" height="1400" fill="#e7d9b6" />
        <rect x="96" y="88" width="908" height="1224" rx="10" fill="#f5ecd1" stroke="#b99761" stroke-width="8" />
        <text x="160" y="210" font-family="Georgia, 'Times New Roman', serif" font-size="54" font-weight="700" fill="#55381f">Official Notice</text>
        <text x="160" y="272" font-family="Georgia, 'Times New Roman', serif" font-size="28" fill="#6d4d2b">Historical archive copy</text>
        <g font-family="Georgia, 'Times New Roman', serif" font-size="32" fill="#6b4a2b">
          <text x="160" y="376">To all departments and clerks,</text>
          <text x="160" y="446">This memorandum records the revised guidance</text>
          <text x="160" y="516">for materials handling and public notice display.</text>
          <text x="160" y="616">Signed and entered into the archive ledger.</text>
          <text x="160" y="756">Witnessed on the twelfth day of the month.</text>
          <text x="160" y="826">Seal attached on the reverse side.</text>
          <text x="160" y="1010">Filed by the office of records.</text>
        </g>
        <path d="M170 1130 C320 1040, 410 1220, 600 1110" stroke="#7a5430" stroke-width="9" fill="none" stroke-linecap="round" />
        <ellipse cx="772" cy="1106" rx="112" ry="88" fill="none" stroke="#8b2e22" stroke-width="10" opacity="0.75" />
        <text x="724" y="1116" font-family="Helvetica, Arial, sans-serif" font-size="26" fill="#8b2e22" font-weight="700">ARCHIVE</text>
      </svg>`,
  },
  {
    filename: 'desktop-settings-screenshot.png',
    width: 1440,
    height: 900,
    svg: `
      <svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900" viewBox="0 0 1440 900">
        <rect width="1440" height="900" fill="#cfd9e6" />
        <rect x="88" y="78" width="1264" height="744" rx="26" fill="#f5f8fb" stroke="#9fb0c2" stroke-width="6" />
        <rect x="88" y="78" width="1264" height="82" rx="26" fill="#e6edf5" />
        <circle cx="146" cy="120" r="12" fill="#ff6f61" />
        <circle cx="182" cy="120" r="12" fill="#ffcc4d" />
        <circle cx="218" cy="120" r="12" fill="#50c878" />
        <rect x="116" y="186" width="270" height="596" fill="#13324d" />
        <text x="150" y="248" font-family="Helvetica, Arial, sans-serif" font-size="42" font-weight="700" fill="#ffffff">Settings</text>
        <g font-family="Helvetica, Arial, sans-serif" font-size="28" fill="#dbe8f4">
          <text x="150" y="326">Profile</text>
          <text x="150" y="386">Notifications</text>
          <text x="150" y="446">Privacy</text>
          <text x="150" y="506">Appearance</text>
        </g>
        <rect x="438" y="214" width="846" height="546" rx="18" fill="#ffffff" stroke="#d3dfe9" stroke-width="4" />
        <text x="490" y="288" font-family="Helvetica, Arial, sans-serif" font-size="38" font-weight="700" fill="#18344d">Notifications</text>
        <text x="490" y="342" font-family="Helvetica, Arial, sans-serif" font-size="24" fill="#617890">Choose how the app alerts you.</text>
        <g font-family="Helvetica, Arial, sans-serif" font-size="28" fill="#18344d">
          <text x="490" y="430">Desktop alerts</text>
          <text x="490" y="522">Email digest</text>
          <text x="490" y="614">Mention sounds</text>
        </g>
        <g>
          <rect x="1060" y="392" width="120" height="52" rx="26" fill="#1f87ff" />
          <circle cx="1132" cy="418" r="22" fill="#ffffff" />
          <rect x="1060" y="484" width="120" height="52" rx="26" fill="#1f87ff" />
          <circle cx="1132" cy="510" r="22" fill="#ffffff" />
          <rect x="1060" y="576" width="120" height="52" rx="26" fill="#d7e1ea" />
          <circle cx="1088" cy="602" r="22" fill="#ffffff" />
        </g>
      </svg>`,
  },
  {
    filename: 'stable-doge-meme.png',
    width: 1080,
    height: 1080,
    svg: `
      <svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
        <rect width="1080" height="1080" fill="#efe3c4" />
        <text x="540" y="120" text-anchor="middle" font-family="Impact, Helvetica, Arial, sans-serif" font-size="96" fill="#ffffff" stroke="#000000" stroke-width="8">SUCH TESTS</text>
        <text x="540" y="1010" text-anchor="middle" font-family="Impact, Helvetica, Arial, sans-serif" font-size="96" fill="#ffffff" stroke="#000000" stroke-width="8">MUCH STABLE</text>
        <ellipse cx="540" cy="560" rx="228" ry="266" fill="#d5a15a" />
        <ellipse cx="540" cy="610" rx="188" ry="188" fill="#f4e4bf" />
        <path d="M350 388 L422 186 L514 350 Z" fill="#d5a15a" />
        <path d="M730 388 L658 186 L566 350 Z" fill="#d5a15a" />
        <path d="M392 350 L434 246 L492 334 Z" fill="#f4e4bf" />
        <path d="M688 350 L646 246 L588 334 Z" fill="#f4e4bf" />
        <ellipse cx="454" cy="554" rx="44" ry="54" fill="#1f1b1a" />
        <ellipse cx="626" cy="554" rx="44" ry="54" fill="#1f1b1a" />
        <circle cx="642" cy="534" r="12" fill="#ffffff" />
        <ellipse cx="540" cy="668" rx="52" ry="38" fill="#1f1b1a" />
        <path d="M452 742 Q540 794 628 742" fill="none" stroke="#1f1b1a" stroke-width="16" stroke-linecap="round" />
      </svg>`,
  },
];

async function generateFixture(fixture) {
  const outPath = path.join(OUT_DIR, fixture.filename);
  const input = Buffer.from(fixture.svg.replace(/\n\s+/g, '\n').trim());
  await sharp(input)
    .png()
    .toFile(outPath);
  return outPath;
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  for (const fixture of fixtures) {
    await generateFixture(fixture);
  }
}

main().catch((error) => {
  console.error('failed to generate multimodal eval fixtures');
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
