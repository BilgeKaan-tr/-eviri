// Tarayıcı HTML'lerindeki <script type="module"> bloklarının sözdizimini
// denetler (import/CDN/DOM bağımlılıklarını saplama ile değiştirip node --check).
import fs from "node:fs";
import { execSync } from "node:child_process";

const files = ["cevir.html", "cevir-kendi.html", "egit.html"];
const STUBS =
  'const MT_BUNDLE="self.MT={};";const PDFLib={};const fontkit={};' +
  'const window={};const navigator={hardwareConcurrency:4};const indexedDB={open(){return{};}};' +
  'const Worker=function(){};const Blob=function(){};const URL={createObjectURL(){return"";}};' +
  'const document={getElementById:()=>({addEventListener(){},classList:{add(){},remove(){}},querySelector:()=>({}),files:[]}),createElement:()=>({})};\n';

let ok = true;
for (const f of files) {
  if (!fs.existsSync(f)) continue;
  const h = fs.readFileSync(f, "utf8");
  const m = h.match(/<script type="module">([\s\S]*?)<\/script>\s*<\/body>/);
  if (!m) { console.error(`${f}: modül script bulunamadı`); ok = false; continue; }
  let c = m[1]
    .split("\n").filter((l) => !/^\s*import\s/.test(l)).join("\n") // tüm import satırları
    .replace(/^\s*pdfjsLib\.GlobalWorkerOptions[\s\S]*?;$/m, "")
    .replace(/^\s*const \{ PDFDocument, rgb \} = PDFLib;$/m, "const PDFDocument={},rgb=()=>{};")
    .replace(/^\s*const MT = \(\(\) =>[\s\S]*?\)\(\);$/m, "const MT={};")
    .replace(/\bpdfjsLib\b/g, "({getDocument:()=>({}),GlobalWorkerOptions:{}})")
    .replace(/\bfranc\b/g, "(()=>'eng')");
  fs.writeFileSync("/tmp/_htmlchk.mjs", STUBS + c);
  try { execSync("node --check /tmp/_htmlchk.mjs", { stdio: "pipe" }); console.log(`${f}: OK`); }
  catch (e) { console.error(`${f}: SÖZDİZİMİ HATASI\n` + (e.stderr || e.stdout || e.message).toString()); ok = false; }
}
process.exit(ok ? 0 : 1);
