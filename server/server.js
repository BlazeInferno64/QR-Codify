'use strict';

import dotenv from 'dotenv';

// Load environment variables from .env file in local development, but skip in Vercel where they are injected automatically.
if (!process.env.VERCEL) {
    dotenv.config();
}

import express from "express";
import helmet from "helmet";
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
    // Calculate the rough size of the incoming HTTP headers
    const headersSize = req.rawHeaders ? req.rawHeaders.reduce((acc, current) => acc + current.length, 0) : 0;

    // Add the content-length of the body if it exists
    const bodySize = parseInt(req.headers['content-length'], 10) || 0;

    const totalIncomingBytes = headersSize + bodySize;
    return chalk.yellow(formatBytes(totalIncomingBytes));
});

// Token to calculate outgoing response body volume
morgan.token('outgoing_bytes', (req, res) => {
    const outgoing = parseInt(res.getHeader('content-length'), 10) || 0;
    return chalk.green(formatBytes(outgoing));
});

//  Extract and normalize client IP
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
    // Calculate precise diff in milliseconds
    const ms = (res._startAt[0] - req._startAt[0]) * 1e3 + (res._startAt[1] - req._startAt[1]) * 1e-6;
    const formatted = `${ms.toFixed(2)} ms`;

    if (ms > 400) return chalk.red.bold(formatted);   // Performance bottleneck
    if (ms > 150) return chalk.yellow.bold(formatted); // Moderate latency
    return chalk.green(formatted);                    // Fast execution
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

// Select format layout based on deployment environment (Multi-line local, Streamlined production)
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
app.use(express.json({ limit: '10mb' }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.set('trust proxy', true);
app.disable('x-powered-by');

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

// Middleware to parse raw binary data for binary image uploads
const rawParser = express.raw({ type: 'image/*', limit: '10mb' });

app.get('/logo', async (req, res) => {
    try {
        const size = 512;
        const canvas = createCanvas(size, size);
        const ctx = canvas.getContext('2d');

        // Clean helper to draw fluid rounded panels safely
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

        // 1. Sleek deep dark space background
        ctx.fillStyle = '#060913';
        ctx.fillRect(0, 0, size, size);

        // 2. Proportioned QR component (Centered vertically: 256 - 60 = 196)
        const eyeX = 64;
        const eyeY = 196; // Perfectly splits the 512px height frame evenly

        drawRoundedCard(eyeX, eyeY, 120, 120, 32, '#00E5FF'); // Neon Cyan Outer Ring
        drawRoundedCard(eyeX + 22, eyeY + 22, 76, 76, 18, '#060913'); // Core background knockout
        drawRoundedCard(eyeX + 40, eyeY + 40, 40, 40, 10, '#00E5FF'); // Solid Inner Eye

        // 3. Typographic Branding using Vercel Geist Mono
        ctx.textAlign = 'left';

        // Changing to 'middle' allows us to align text perfectly with the 
        // horizontal center line of the QR Finder Eye (eyeY + 60)
        ctx.textBaseline = 'middle';

        const textStartX = 214;
        const textCenterY = eyeY + 60; // 256px (Perfect horizontal center-line)

        // Primary Title: "QR"
        ctx.font = '700 48px "Geist Mono"';
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText('QR', textStartX, textCenterY - 10); // Elevated slightly to balance subtitle spacing

        // Calculate offset dynamically for perfect monospace inline alignment
        // Measuring "QR " with a trailing space provides standard character tracking gap
        const qrWidth = ctx.measureText('QR ').width;

        // Secondary Title: "Codify"
        ctx.font = '700 48px "Geist Mono"';
        ctx.fillStyle = '#94A3B8'; // Premium slate text color
        ctx.fillText('Codify', textStartX + qrWidth, textCenterY - 10);

        // 4. Structural Subtitle Decorator with a Neon Pulse Element
        // Small active engine indicator block
        ctx.fillStyle = '#00E5FF';
        ctx.fillRect(textStartX, textCenterY + 32, 6, 6);

        // Subtitle Text
        ctx.font = '500 16px "Geist Mono"';
        ctx.fillStyle = '#475569'; // Clean muted gray
        ctx.fillText('QR Codes done right!', textStartX + 16, textCenterY + 34);

        // Convert canvas data directly into a raw binary buffer stream
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

app.all('/api/generate', rawParser, async (req, res) => {
    try {
        const { data, size, theme, banner: queryBanner } = { ...req.body, ...req.query };

        if (!data) {
            return res.status(400).json({ error: "The 'data' query or body parameter is required." });
        }

        if (data.length > 1200) {
            return res.status(400).json({ error: "Data payload is too large. Maximum length allowed is 1200 characters." });
        }

        // Safe parsing for size query parameters (Handles: 500, "500", "500x500", "500x300")
        let qrSize = 500; // Default fallback size
        if (req.query.size) {
            const sizeStr = String(req.query.size).trim().toLowerCase();

            if (sizeStr.includes('x')) {
                // Split by 'x' and parse the first dimension (width) as our square dimension
                const parts = sizeStr.split('x');
                const parsedWidth = parseInt(parts[0], 10);
                if (!isNaN(parsedWidth)) {
                    qrSize = parsedWidth;
                }
            } else {
                // Handle standard single dimension format
                const parsedSize = parseInt(sizeStr, 10);
                if (!isNaN(parsedSize)) {
                    qrSize = parsedSize;
                }
            }
        }

        const activeTheme = (theme && QR_THEMES[theme.toLowerCase()]) ? QR_THEMES[theme.toLowerCase()] : null;

        // QR Matrix Setup
        const qrMatrix = QRCode.create(data, { errorCorrectionLevel: 'H' }).modules;
        const moduleCount = qrMatrix.size;

        const MARGIN = 1;
        const totalModules = moduleCount + MARGIN * 2;
        const moduleSize = qrSize / totalModules;

        // Canvas Setup
        const canvas = createCanvas(qrSize, qrSize);
        const ctx = canvas.getContext('2d');

        const bgColour = activeTheme ? activeTheme.background : '#FFFFFF';
        ctx.fillStyle = bgColour;
        ctx.fillRect(0, 0, qrSize, qrSize);

        const mainFill = activeTheme ? activeTheme.getFill(ctx, qrSize) : '#000000';

        // Custom Geometry Drawing Methods (with strict Skia compatibility)
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
            ctx.beginPath(); // Clear path context immediately for Skia
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

        // Globally defined sizing constraints to ensure scoping safety inside loop iterations
        const bannerMatrixSize = Math.floor(moduleCount * 0.24);
        const centerStart = Math.floor((moduleCount - bannerMatrixSize) / 2);
        const centerEnd = centerStart + bannerMatrixSize;

        // Force clear all data bits inside the central banner region to eliminate neighbor checking edge-cases
        for (let r = centerStart; r < centerEnd; r++) {
            for (let c = centerStart; c < centerEnd; c++) {
                qrMatrix.set(r, c, 0);
            }
        }

        // Matrix Rendering Loop
        ctx.fillStyle = mainFill;
        for (let row = 0; row < moduleCount; row++) {
            for (let col = 0; col < moduleCount; col++) {
                const inFinder = finderZones.some(([fc, fr]) =>
                    col >= fc && col < fc + 8 && row >= fr && row < fr + 8
                );
                if (inFinder) continue;

                // Stop loop early if inside center banner area
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
                        ctx.beginPath(); // Keep global path clean
                    }
                }
            }
        }

        // Top Layer Finders
        drawFinder(0, 0);
        drawFinder(moduleCount - 7, 0);
        drawFinder(0, moduleCount - 7);

        // Banner Detection
        let bannerBuffer = null;
        let hasImageBanner = false;

        if (Buffer.isBuffer(req.body) && req.body.length > 0) {
            bannerBuffer = req.body;
        }
        else if (queryBanner) {
            const rawBase64 = queryBanner.startsWith('data:image') ? queryBanner.split(',')[1] : queryBanner;
            const cleanBase64 = rawBase64.trim().replace(/ /g, '+');
            bannerBuffer = Buffer.from(cleanBase64, 'base64');
        }

        if (bannerBuffer && bannerBuffer.length >= 8) {
            try {
                const bannerImg = await loadImage(bannerBuffer);

                const bannerSize = qrSize * 0.16;
                const centerPos = (qrSize - bannerSize) / 2;
                const bgPad = activeTheme ? 8 : 5;

                ctx.fillStyle = bgColour;
                drawRoundedRect(
                    centerPos - bgPad,
                    centerPos - bgPad,
                    bannerSize + bgPad * 2,
                    bannerSize + bgPad * 2,
                    activeTheme ? moduleSize * 1.2 : moduleSize * 0.8
                );

                ctx.drawImage(bannerImg, centerPos, centerPos, bannerSize, bannerSize);
                hasImageBanner = true;
            } catch (imageError) {
                console.error("Failed to process image asset, falling back to typography:", imageError.message);
            }
        }

        // Fallback Vector Text Branding
        if (!hasImageBanner) {
            const badgeSize = qrSize * 0.24; // Expanded to safely encompass the text layout bounds
            const centerPos = (qrSize - badgeSize) / 2;
            const centerCoord = qrSize / 2;

            // Draw clean background block for the logo card
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

            // Top Primary Text
            ctx.font = '700 34px "Geist Mono"';
            ctx.fillStyle = textMainColor;
            ctx.fillText('QR', centerCoord, centerCoord - 14);

            // Bottom Branding Accent Text
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
        res.send(buffer);

    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: "An error occurred while generating the QR code." });
    }
});

app.post('/api/read', rawParser, async (req, res) => {
    try {
        let imageBuffer;

        if (req.headers['content-type'] && req.headers['content-type'].includes('application/json')) {
            const { image } = req.body;
            if (!image) {
                return res.status(400).json({ success: false, error: "The 'image' property is required." });
            }
            const rawBase64 = image.startsWith('data:image') ? image.split(',')[1] : image;
            const cleanBase64 = rawBase64.trim().replace(/ /g, '+');
            imageBuffer = Buffer.from(cleanBase64, 'base64');
        }
        else if (Buffer.isBuffer(req.body) && req.body.length > 0) {
            imageBuffer = req.body;
        }
        else {
            return res.status(400).json({
                success: false,
                error: "Invalid request. Provide a JSON body with an 'image' base64 string, or upload a raw binary image."
            });
        }

        const image = await loadImage(imageBuffer);
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
        if (error.name === 'NotFoundException' || error.message?.includes('No MultiFormat Readers')) {
            return res.status(422).json({
                success: false,
                error: "Could not detect or decode any valid QR code from the provided image layout."
            });
        }

        console.error(error);
        return res.status(500).json({ success: false, error: "An error occurred while reading the QR code." });
    }
});

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