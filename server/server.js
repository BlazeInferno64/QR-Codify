'use strict';

import dotenv from 'dotenv';

// Load environment variables from .env file in local development, but skip in Vercel where they are injected automatically.
if (!process.env.VERCEL) {
    dotenv.config();
}

import express from "express";
import helmet from "helmet";
import compression from 'compression';
import cors from "cors";
import rateLimit from "express-rate-limit";
import path from "path";
import ejs from "ejs";
import { fileURLToPath } from 'url';
import morgan from 'morgan';
import chalk from 'chalk';
import QRCode from "qrcode";
import { MultiFormatReader, RGBLuminanceSource, BinaryBitmap, HybridBinarizer, DecodeHintType, BarcodeFormat } from '@zxing/library';
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import Busboy from 'busboy';

import packageJson from '../package.json' with { type: 'json' };

const formatBytes = (bytes) => {
    if (!bytes || isNaN(bytes) || bytes <= 0) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(2))} ${sizes[i]}`;
};

const myLimit = 45

const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: myLimit,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { trustProxy: false },
    message: {
        status: 'failed',
        message: `Whoa! You just triggered the rate limit of this rest api! Please try again later`,
    }
})

const app = express();
const PORT = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { QR_THEMES } from './themes/themes.js';

const fontDir = path.join(__dirname, 'fonts');

// Registers the local Geist Mono font family for canvas usage.
try {
    GlobalFonts.registerFromPath(path.join(fontDir, 'GeistMono-Medium.ttf'), 'Geist Mono');
    GlobalFonts.registerFromPath(path.join(fontDir, 'GeistMono-Bold.ttf'), 'Geist Mono');
} catch (e) {
    console.log('Font files not found at the resolved local paths, using canvas fallback properties safely.');
}

// Token to calculate incoming request payload volume (Headers + Body size)
morgan.token('incoming_bytes', (req) => {
    const headersSize = req.rawHeaders ? req.rawHeaders.reduce((acc, current) => acc + current.length, 0) : 0;
    const bodySize = parseInt(req.headers['content-length'], 10) || 0;
    const totalIncomingBytes = headersSize + bodySize;
    return chalk.yellow(formatBytes(totalIncomingBytes));
});

// Token to calculate outgoing response body volume
morgan.token('outgoing_bytes', (req, res) => {
    const outgoing = parseInt(res.getHeader('content-length'), 10) || 0;
    return chalk.green(formatBytes(outgoing));
});

// Extract and normalize client IP
morgan.token('user_ip', (req) => {
    return req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '::1';
});

// Color-code HTTP methods natively
morgan.token('color_method', (req) => {
    const methods = {
        GET: chalk.green.bold('GET'),
        POST: chalk.blue.bold('POST'),
        PUT: chalk.yellow.bold('PUT'),
        DELETE: chalk.red.bold('DELETE')
    };
    return methods[req.method] || chalk.white.bold(req.method);
});

// Color-code response time based on execution latency thresholds
morgan.token('color_res_time', (req, res) => {
    if (!req._startAt || !res._startAt) return '0.00 ms';
    const ms = (res._startAt[0] - req._startAt[0]) * 1e3 + (res._startAt[1] - req._startAt[1]) * 1e-6;
    const formatted = `${ms.toFixed(2)} ms`;

    if (ms > 400) return chalk.red.bold(formatted);
    if (ms > 150) return chalk.yellow.bold(formatted);
    return chalk.green(formatted);
});

// Extract operational context metadata safely (No raw data logging)
morgan.token('qr_meta', (req) => {
    if (req.originalUrl.startsWith('/api/generate')) {
        const payload = { ...req.body, ...req.query };
        const theme = payload.theme ? payload.theme.toLowerCase() : 'default';
        const dataLength = payload.data ? String(payload.data).length : 0;
        return chalk.gray(`[Theme: ${theme} | Len: ${dataLength}ch]`);
    }
    if (req.originalUrl.startsWith('/api/read')) {
        const mode = req.headers['content-type']?.includes('application/json') ? 'Base64' : 'Binary';
        return chalk.gray(`[Mode: ${mode}]`);
    }
    return '';
});

morgan.token('color_agent', (req) => {
    return chalk.cyan(req.headers['user-agent'] || 'Unknown');
});

morgan.token('color_status', (req, res) => {
    const status = res.statusCode;
    const color = status >= 500 ? chalk.red.bold :
        status >= 400 ? chalk.yellow.bold :
            status >= 300 ? chalk.blue.bold : chalk.green.bold;
    return color(status);
});

const isVercel = !!process.env.VERCEL;

const myCustomFormat = isVercel
    ? `[:color_method] :url -> Status: :color_status | In: :incoming_bytes | Out: :outgoing_bytes | Time: :color_res_time | IP: :user_ip :qr_meta`
    : `\n${chalk.bold.underline('📥 QR Codify Incoming Request')}\n` +
    ` ├─ Request : :color_method ${chalk.white(':url')} HTTP/:http-version :qr_meta\n` +
    ` ├─ Identity: IP '${chalk.magenta(':user_ip')}' | Agent: :color_agent\n` +
    ` ├─ Traffic : Incoming: :incoming_bytes | Outgoing: :outgoing_bytes\n` +
    ` └─ Outcome : Status :color_status in :color_res_time on [${chalk.green(':date[clf]')}]\n`;

app.use(morgan(myCustomFormat));

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com"],
            connectSrc: ["'self'", "https://cdn.jsdelivr.net", "https://api.qrserver.com", "https://fonts.gstatic.com"],
            fontSrc: ["'self'", "https://cdn.jsdelivr.net", "https://fonts.gstatic.com", "https://fonts.googleapis.com", "data:"],
            imgSrc: ["'self'", "data:", "blob:", "https:"],
        },
    },
    crossOriginResourcePolicy: false,
    xDownloadOptions: false,
}));
app.use(limiter);
app.use('/api', cors());
app.use(compression({ filter: shouldCompress }))

// Keep Global JSON parsing active for generic structured routing configurations
app.use(express.json({ limit: '10mb' }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.set('trust proxy', true);
app.disable('x-powered-by');

// Middleware to parse raw binary payloads dynamically ONLY where needed
const rawParser = express.raw({ type: 'image/*', limit: '10mb' });

app.get('/', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('QR-Codify-Engine-Version', packageJson.version);
    const year = new Date().getFullYear();
    return res.render('index', {
        'themeNum': 4,
        'themeWord': 'Four',
        'previewTheme': 'cyber',
        'serverYear': year,
        'rateLim': myLimit,
    });
});

app.get('/health', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('QR-Codify-Engine-Version', packageJson.version);
    return res.json({ status: 'ok', message: 'Server is healthy and running.', version: packageJson.version });
});

app.get('/version', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('QR-Codify-Engine-Version', packageJson.version);
    return res.json({ version: packageJson.version });
});

app.get('/about', (req, res) => {
    return res.redirect('https://github.com/blazeinferno64/QR-Codify');
});

app.get('/api/themes', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('QR-Codify-Engine-Version', packageJson.version);
    return res.json({ themes: Object.keys(QR_THEMES) });
});

app.get('/api/themes/:themeName', (req, res) => {
    const themeName = req.params.themeName.toLowerCase();
    const theme = QR_THEMES[themeName];
    if (!theme) {
        return res.status(404).json({ status: 'failed', message: 'Theme not found.' });
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('QR-Codify-Engine-Version', packageJson.version);
    return res.json({ theme });
});

app.get('/api/themes/:themeName/preview', async (req, res) => {
    const themeName = req.params.themeName.toLowerCase();
    const theme = QR_THEMES[themeName];
    if (!theme) {
        return res.status(404).json({ status: 'failed', message: 'Theme not found.' });
    }
    try {
        const size = 512;
        const canvas = createCanvas(size, size);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = theme.background;
        ctx.fillRect(0, 0, size, size);
        const mainFill = theme.getFill(ctx, size);
        ctx.fillStyle = mainFill;
        ctx.font = '700 48px "Geist Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(themeName, size / 2, size / 2);
        const buffer = await canvas.toBuffer('image/png');
        res.type('image/png');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('QR-Codify-Engine-Version', packageJson.version);
        return res.send(buffer);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ status: 'failed', message: 'Failed to generate theme preview.' });
    }
});

app.get('/logo', async (req, res) => {
    try {
        const size = 512;
        const canvas = createCanvas(size, size);
        const ctx = canvas.getContext('2d');

        function drawRoundedCard(x, y, w, h, r, fillStyle) {
            r = Math.min(r, w / 2, h / 2);
            ctx.fillStyle = fillStyle;
            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.lineTo(x + w - r, y);
            ctx.quadraticCurveTo(x + w, y, x + w, y + r);
            ctx.lineTo(x + w, y + h - r);
            ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
            ctx.lineTo(x + r, y + h);
            ctx.quadraticCurveTo(x, y + h, x, y + h - r);
            ctx.lineTo(x, y + r);
            ctx.quadraticCurveTo(x, y, x + r, y);
            ctx.closePath();
            ctx.fill();
        }

        ctx.fillStyle = '#060913';
        ctx.fillRect(0, 0, size, size);

        const eyeX = 64;
        const eyeY = 196;

        drawRoundedCard(eyeX, eyeY, 120, 120, 32, '#00E5FF');
        drawRoundedCard(eyeX + 22, eyeY + 22, 76, 76, 18, '#060913');
        drawRoundedCard(eyeX + 40, eyeY + 40, 40, 40, 10, '#00E5FF');

        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        const textStartX = 214;
        const textCenterY = eyeY + 60;

        ctx.font = '700 48px "Geist Mono"';
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText('QR', textStartX, textCenterY - 10);

        const qrWidth = ctx.measureText('QR ').width;

        ctx.font = '700 48px "Geist Mono"';
        ctx.fillStyle = '#94A3B8';
        ctx.fillText('Codify', textStartX + qrWidth, textCenterY - 10);

        ctx.fillStyle = '#00E5FF';
        ctx.fillRect(textStartX, textCenterY + 32, 6, 6);

        ctx.font = '500 16px "Geist Mono"';
        ctx.fillStyle = '#475569';
        ctx.fillText('QR Codes done right!', textStartX + 16, textCenterY + 34);

        const buffer = await canvas.toBuffer('image/png');

        res.type('image/png');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('QR-Codify-Logo', 'true');
        res.setHeader('QR-Codify-Engine-Version', packageJson.version);

        return res.send(buffer);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ status: 'failed', message: 'Failed to generate the server logo.' });
    }
});

app.get('/favicon.ico', (req, res) => {
    return res.redirect('/logo');
});

// ====================================================================
// UPGRADED /api/generate ENDPOINT
// Removed rawParser from header block to stop middleware execution collision
// ====================================================================
app.all('/api/generate', async (req, res) => {
    try {
        let data, size, theme, queryBanner;
        let bannerBuffer = null;
        const contentType = req.headers['content-type'] || '';

        // A. HANDLE MULTIPART FORM DATA PAYLOADS
        if (contentType.includes('multipart/form-data')) {
            await new Promise((resolve, reject) => {
                const busboy = Busboy({ headers: req.headers });
                const fields = {};
                let fileBuffer = null;

                busboy.on('field', (name, val) => {
                    fields[name] = val;
                });

                busboy.on('file', (name, file, info) => {
                    if (name === 'banner') {
                        const chunks = [];
                        file.on('data', (chunk) => chunks.push(chunk));
                        file.on('end', () => {
                            fileBuffer = Buffer.concat(chunks);
                        });
                    } else {
                        file.resume();
                    }
                });

                busboy.on('finish', () => {
                    const combined = { ...fields, ...req.query };
                    data = combined.data;
                    size = combined.size;
                    theme = combined.theme;
                    queryBanner = combined.banner;
                    bannerBuffer = fileBuffer;
                    resolve();
                });

                busboy.on('error', (err) => reject(err));
                req.pipe(busboy);
            });
        }
        // B. HANDLE RAW BINARY PAYLOADS (Manually evaluate string chunk allocation)
        else if (contentType.includes('image/')) {
            bannerBuffer = await new Promise((resolve, reject) => {
                const chunks = [];
                req.on('data', (chunk) => chunks.push(chunk));
                req.on('end', () => resolve(Buffer.concat(chunks)));
                req.on('error', (err) => reject(err));
            });
            ({ data, size, theme } = req.query);
        }
        // C. FALLBACK TO STANDARD JSON PAYLOAD (Matches express.json parsing layers)
        else {
            ({ data, size, theme, banner: queryBanner } = { ...req.body, ...req.query });

            if (queryBanner && typeof queryBanner === 'string') {
                const rawBase64 = queryBanner.startsWith('data:image') ? queryBanner.split(',')[1] : queryBanner;
                const cleanBase64 = rawBase64.trim().replace(/ /g, '+');
                bannerBuffer = Buffer.from(cleanBase64, 'base64');
            }
        }

        // --- VALIDATION LAYER ---
        if (!data) {
            return res.status(400).json({ error: "The 'data' query or body parameter is required." });
        }

        if (data.length > 1200) {
            return res.status(400).json({ error: "Data payload is too large. Maximum length allowed is 1200 characters." });
        }

        let qrSize = 500;
        const sizeTarget = size || req.query.size;
        if (sizeTarget) {
            const sizeStr = String(sizeTarget).trim().toLowerCase();
            if (sizeStr.includes('x')) {
                const parts = sizeStr.split('x');
                const parsedWidth = parseInt(parts[0], 10);
                if (!isNaN(parsedWidth)) qrSize = parsedWidth;
            } else {
                const parsedSize = parseInt(sizeStr, 10);
                if (!isNaN(parsedSize)) qrSize = parsedSize;
            }
        }

        const activeTheme = (theme && QR_THEMES[theme.toLowerCase()]) ? QR_THEMES[theme.toLowerCase()] : null;

        // QR Matrix Setup
        const qrMatrix = QRCode.create(data, { errorCorrectionLevel: 'H' }).modules;
        const moduleCount = qrMatrix.size;

        const MARGIN = 1;
        const totalModules = moduleCount + MARGIN * 2;
        const moduleSize = qrSize / totalModules;

        // Canvas Layout Generation
        const canvas = createCanvas(qrSize, qrSize);
        const ctx = canvas.getContext('2d');

        const bgColour = activeTheme ? activeTheme.background : '#FFFFFF';
        ctx.fillStyle = bgColour;
        ctx.fillRect(0, 0, qrSize, qrSize);

        const mainFill = activeTheme ? activeTheme.getFill(ctx, qrSize) : '#000000';

        function drawRoundedRect(x, y, w, h, r) {
            r = Math.min(r, w / 2, h / 2);
            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.lineTo(x + w - r, y);
            ctx.quadraticCurveTo(x + w, y, x + w, y + r);
            ctx.lineTo(x + w, y + h - r);
            ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
            ctx.lineTo(x + r, y + h);
            ctx.quadraticCurveTo(x, y + h, x, y + h - r);
            ctx.lineTo(x, y + r);
            ctx.quadraticCurveTo(x, y, x + r, y);
            ctx.closePath();
            ctx.fill();
            ctx.beginPath();
        }

        function drawFinder(col, row) {
            const x = (col + MARGIN) * moduleSize;
            const y = (row + MARGIN) * moduleSize;
            const outer = 7 * moduleSize;

            const outerR = activeTheme ? moduleSize * activeTheme.finderOuterRadiusScale : moduleSize * 1.5;
            const innerR = activeTheme ? moduleSize * activeTheme.finderInnerRadiusScale : moduleSize * 0.8;
            const useCircleEye = activeTheme ? activeTheme.isFinderEyeCircle : false;

            ctx.fillStyle = mainFill;
            drawRoundedRect(x, y, outer, outer, outerR);

            ctx.fillStyle = bgColour;
            const gap = moduleSize;
            drawRoundedRect(x + gap, y + gap, 5 * moduleSize, 5 * moduleSize, innerR);

            ctx.fillStyle = mainFill;
            const innerPad = 2 * moduleSize;
            const innerSize = 3 * moduleSize;

            if (useCircleEye) {
                ctx.beginPath();
                ctx.arc(x + 3.5 * moduleSize, y + 3.5 * moduleSize, innerSize / 2, 0, Math.PI * 2);
                ctx.fill();
                ctx.beginPath();
            } else {
                drawRoundedRect(x + innerPad, y + innerPad, innerSize, innerSize, moduleSize * 0.5);
            }
        }

        const finderZones = [[0, 0], [moduleCount - 7, 0], [0, moduleCount - 7]];

        const bannerMatrixSize = Math.floor(moduleCount * 0.24);
        const centerStart = Math.floor((moduleCount - bannerMatrixSize) / 2);
        const centerEnd = centerStart + bannerMatrixSize;

        for (let r = centerStart; r < centerEnd; r++) {
            for (let c = centerStart; c < centerEnd; c++) {
                qrMatrix.set(r, c, 0);
            }
        }

        // Rendering Matrix Bits
        ctx.fillStyle = mainFill;
        for (let row = 0; row < moduleCount; row++) {
            for (let col = 0; col < moduleCount; col++) {
                const inFinder = finderZones.some(([fc, fr]) =>
                    col >= fc && col < fc + 8 && row >= fr && row < fr + 8
                );
                if (inFinder) continue;

                if (col >= centerStart && col < centerEnd && row >= centerStart && row < centerEnd) {
                    continue;
                }

                if (qrMatrix.get(row, col)) {
                    const x = (col + MARGIN) * moduleSize;
                    const y = (row + MARGIN) * moduleSize;

                    if (activeTheme && activeTheme.isLiquid) {
                        const hasTopNeighbor = row > 0 && qrMatrix.get(row - 1, col);
                        const hasBottomNeighbor = row < moduleCount - 1 && qrMatrix.get(row + 1, col);

                        const dotWidth = moduleSize * 0.88;
                        const padding = (moduleSize - dotWidth) / 2;

                        const cx = x + padding;
                        let cy = y + padding;
                        let ch = dotWidth;
                        let r = dotWidth / 2;

                        if (hasTopNeighbor) { cy -= padding; ch += padding; }
                        if (hasBottomNeighbor) { ch += padding; }

                        drawRoundedRect(cx, cy, dotWidth, ch, r);
                    } else {
                        const dotRadius = moduleSize * 0.44;
                        const cx = x + moduleSize / 2;
                        const cy = y + moduleSize / 2;
                        ctx.beginPath();
                        ctx.arc(cx, cy, dotRadius, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.beginPath();
                    }
                }
            }
        }

        drawFinder(0, 0);
        drawFinder(moduleCount - 7, 0);
        drawFinder(0, moduleCount - 7);

        // Render Banner/Branding Overlay Layers
        let hasImageBanner = false;

        if (bannerBuffer && bannerBuffer.length >= 8) {
            try {
                const bannerImg = await loadImage(bannerBuffer);
                const bannerSize = qrSize * 0.16;
                const centerPos = (qrSize - bannerSize) / 2;
                const bgPad = activeTheme ? 8 : 5;

                ctx.fillStyle = bgColour;
                drawRoundedRect(centerPos - bgPad, centerPos - bgPad, bannerSize + bgPad * 2, bannerSize + bgPad * 2, activeTheme ? moduleSize * 1.2 : moduleSize * 0.8);
                ctx.drawImage(bannerImg, centerPos, centerPos, bannerSize, bannerSize);
                hasImageBanner = true;
            } catch (imageError) {
                console.error("Failed to process image asset, falling back to typography:", imageError.message);
            }
        }

        if (!hasImageBanner && queryBanner && typeof queryBanner === 'string' && queryBanner.startsWith('http')) {
            try {
                const bannerImg = await loadImage(queryBanner);
                const bannerSize = qrSize * 0.16;
                const centerPos = (qrSize - bannerSize) / 2;
                const bgPad = activeTheme ? 8 : 5;

                ctx.fillStyle = bgColour;
                drawRoundedRect(centerPos - bgPad, centerPos - bgPad, bannerSize + bgPad * 2, bannerSize + bgPad * 2, activeTheme ? moduleSize * 1.2 : moduleSize * 0.8);
                ctx.drawImage(bannerImg, centerPos, centerPos, bannerSize, bannerSize);
                hasImageBanner = true;
            } catch (urlImgError) {
                console.error("Failed to fetch image from external URL, falling back to typography:", urlImgError.message);
            }
        }

        if (!hasImageBanner) {
            const badgeSize = qrSize * 0.24;
            const centerPos = (qrSize - badgeSize) / 2;
            const centerCoord = qrSize / 2;

            ctx.fillStyle = bgColour;
            drawRoundedRect(centerPos, centerPos, badgeSize, badgeSize, activeTheme ? moduleSize * 1.2 : moduleSize * 0.8);

            let textMainColor = '#000000';
            let textSubColor = '#444444';

            if (activeTheme) {
                const themeKey = theme.toLowerCase();
                textMainColor = activeTheme.getFill(ctx, qrSize);

                if (themeKey === 'cyber') textSubColor = '#ec4899';
                else if (themeKey === 'tokyonight') textSubColor = '#bb9af7';
                else if (themeKey === 'neon') textSubColor = '#00ffcc';
            }

            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            ctx.font = '700 34px "Geist Mono"';
            ctx.fillStyle = textMainColor;
            ctx.fillText('QR', centerCoord, centerCoord - 14);

            ctx.font = '700 26px "Geist Mono"';
            ctx.fillStyle = textSubColor;
            ctx.fillText('Codify', centerCoord, centerCoord + 16);
        }

        const buffer = await canvas.toBuffer('image/png');
        res.type('image/png');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('QR-Codify-Theme', activeTheme ? theme.toLowerCase() : 'default');
        res.setHeader('QR-Codify-Bytes', buffer.length.toString());
        res.setHeader('QR-Codify-Charset', 'utf-8');
        res.setHeader('QR-Codify-Format', 'QR_CODE');
        res.setHeader('QR-Codify-Error-Correction', 'H');
        res.setHeader('QR-Codify-Size', `${qrSize}x${qrSize}`);
        res.setHeader('QR-Codify-Engine-Version', packageJson.version);
        return res.send(buffer);

    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: "An error occurred while generating the QR code." });
    }
});

// ====================================================================
// UPGRADED /api/read ENDPOINT
// ====================================================================
app.post('/api/read', rawParser, async (req, res) => {
    try {
        let imageBuffer;
        const contentType = req.headers['content-type'] || '';

        if (contentType.includes('application/json')) {
            const { image } = req.body;
            if (!image) {
                return res.status(400).json({ success: false, error: "The 'image' property is required." });
            }
            const rawBase64 = image.startsWith('data:image') ? image.split(',')[1] : image;
            const cleanBase64 = rawBase64.trim().replace(/ /g, '+');
            imageBuffer = Buffer.from(cleanBase64, 'base64');
            if (!imageBuffer || imageBuffer.length < 8) {
                return res.status(400).json({ success: false, error: "Image data is empty or too small to be valid." });
            }
        }
        else if (contentType.includes('multipart/form-data')) {
            imageBuffer = await new Promise((resolve, reject) => {
                const busboy = Busboy({ headers: req.headers });
                let fileBuffer = null;

                busboy.on('file', (name, file, info) => {
                    const chunks = [];
                    file.on('data', (chunk) => chunks.push(chunk));
                    file.on('end', () => {
                        fileBuffer = Buffer.concat(chunks);
                    });
                });

                busboy.on('finish', () => {
                    if (fileBuffer) resolve(fileBuffer);
                    else reject(new Error("No file found inside form data fields. Ensure it is attached under any valid key."));
                });

                busboy.on('error', (err) => reject(err));
                req.pipe(busboy);
            });
        }
        else if (Buffer.isBuffer(req.body) && req.body.length > 0) {
            imageBuffer = req.body;
        }
        else {
            return res.status(400).json({
                success: false,
                error: "Invalid request. Provide a JSON body with an 'image' base64 string, upload a raw binary image, or send form data fields containing your image file."
            });
        }

        //const image = await loadImage(imageBuffer);
        let image;
        try {
            image = await loadImage(imageBuffer);
        } catch {
            return res.status(400).json({ success: false, error: "Could not parse the provided file as an image." });
        }

        if (!image.height || !image.width) {
            return res.status(400).json({
                success: false,
                error: `Please provide a valid image!`
            })
        }
        const canvas = createCanvas(image.width, image.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0, image.width, image.height);

        const imageData = ctx.getImageData(0, 0, image.width, image.height);
        const argbLen = imageData.width * imageData.height;
        const luminancePoints = new Uint8ClampedArray(argbLen);

        for (let i = 0; i < argbLen; i++) {
            const r = imageData.data[i * 4];
            const g = imageData.data[i * 4 + 1];
            const b = imageData.data[i * 4 + 2];
            luminancePoints[i] = (r * 0.2126 + g * 0.7152 + b * 0.0722);
        }

        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);
        hints.set(DecodeHintType.TRY_HARDER, true);

        const reader = new MultiFormatReader();
        reader.setHints(hints);

        const luminanceSource = new RGBLuminanceSource(luminancePoints, imageData.width, imageData.height);
        const binaryBitmap = new BinaryBitmap(new HybridBinarizer(luminanceSource));

        const result = reader.decode(binaryBitmap);

        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('QR-Codify-Format', result.getBarcodeFormat().toString());
        res.setHeader('QR-Codify-Bytes', result.getRawBytes().length.toString());
        res.setHeader('QR-Codify-Engine-Version', packageJson.version);

        return res.json({
            success: true,
            response: result.getText()
        });

    } catch (error) {
        const errorType = error.name || '';
        const errorMsg = error.message || '';

        // 1. SCENARIO A: Image contains QR format signatures but reading matrix layout bits fails 
        if (errorType === 'ChecksumException' || errorType === 'FormatException' || errorMsg.includes('checksum') || errorMsg.includes('format')) {
            return res.status(422).json({
                success: false,
                error: "The QR code provided is invalid or broken, please try again with a different one!"
            });
        }

        // 2. SCENARIO B: ZXing drops a total NotFoundException (No finders tracked at all -> normal photo)
        if (errorType === 'NotFoundException' || errorMsg.includes('No MultiFormat Readers')) {
            return res.status(422).json({
                success: false,
                error: "Could not detect or decode any valid QR code from the provided image layout!"
            });
        }

        // Generic fallback error catch
        console.error(error);
        return res.status(500).json({ success: false, error: "An error occurred while reading the QR code." });
    }
});

function shouldCompress (req, res) {
  if (req.headers['x-no-compression']) {
    // don't compress responses with this request header
    return false
  }

  // fallback to standard filter function
  return compression.filter(req, res)
}

app.use((req, res, next) => {
    if (req.originalUrl.startsWith('/api')) {
        return res.status(404).json({
            status: 'failed',
            message: `The requested endpoint '${req.originalUrl}' was not found on this server!`
        });
    }

    return res.status(404).render('404', {
        path: req.path,
        originalUrl: req.originalUrl,
        method: req.method,
        userAgent: req.get('user-agent') || 'Unknown browser',
        ip: req.ip || 'Unknown IP'
    });
});

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ status: 'failed', message: 'An unexpected error occurred on the server. Please try again later.' });
});

if (!process.env.VERCEL) {
    app.listen(PORT, (err) => {
        if (err) throw err;
        console.log('Running in "Local" environment.');
        return console.log(`QR Codify server is listening on port: '${PORT}'`);
    });
}

export default app;