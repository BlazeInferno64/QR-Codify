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
import { createCanvas, loadImage, registerFont } from 'canvas';

import packageJson from '../package.json' with { type: 'json' };

const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 45,
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
    registerFont(path.join(fontDir, 'GeistMono-Medium.ttf'), { family: 'Geist Mono', weight: '500' });
    registerFont(path.join(fontDir, 'GeistMono-Bold.ttf'), { family: 'Geist Mono', weight: '700' });
} catch (e) {
    console.log('Font files not found at the resolved local paths, using canvas fallback properties safely.');
}


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
    ? `[:color_method] :url -> Status: :color_status | Time: :color_res_time | IP: :user_ip :qr_meta`
    : `\n${chalk.bold.underline('📥 QR Codify Incoming Request')}\n` +
      ` ├─ Request : :color_method ${chalk.white(':url')} HTTP/:http-version :qr_meta\n` +
      ` ├─ Identity: IP '${chalk.magenta(':user_ip')}' | Agent: :color_agent\n` +
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
    return res.render('index');
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
        ctx.textAlign = 'center'; 3
        ctx.textBaseline = 'middle';
        ctx.fillText(themeName, size / 2, size / 2);
        const buffer = canvas.toBuffer('image/png');
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

        /*
            if (req.get('x-internal-request') !== 'true') {
                return res.status(404).end()
            }*/

        const size = 512;
        const canvas = createCanvas(size, size);
        const ctx = canvas.getContext('2d');

        function roundedRect(x, y, w, h, r) {
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

        // soft background
        ctx.fillStyle = '#F7F9FC';
        ctx.fillRect(0, 0, size, size);

        // subtle shadow card
        ctx.fillStyle = 'rgba(15, 23, 42, 0.08)';
        roundedRect(44, 52, 424, 408, 36);

        // main logo card
        ctx.fillStyle = '#FFFFFF';
        roundedRect(40, 48, 424, 408, 36);

        // QR-style icon block only (not a full QR code)
        ctx.fillStyle = '#111827';
        roundedRect(96, 116, 120, 120, 22);
        ctx.fillStyle = '#FFFFFF';
        roundedRect(116, 136, 80, 80, 18);
        ctx.fillStyle = '#111827';
        roundedRect(136, 156, 40, 40, 10);

        // small QR dots for the icon feel
        const dots = [
            [240, 150], [270, 150], [300, 150],
            [240, 180], [300, 180],
            [240, 210], [270, 210], [300, 210]
        ];
        ctx.fillStyle = '#111827';
        dots.forEach(([x, y]) => {
            ctx.beginPath();
            ctx.arc(x, y, 8, 0, Math.PI * 2);
            ctx.fill();
        });

        // text branding
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.font = '700 44px "Geist Mono", monospace';
        ctx.fillStyle = '#111827';
        ctx.fillText('QR Codify', 96, 306);

        ctx.font = '700 20px "Geist Mono", monospace';
        ctx.fillStyle = '#6B7280';
        ctx.fillText('All in one solution for\nQR codes', 96, 352);

        const buffer = canvas.toBuffer('image/png');
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

app.all('/api/generate', rawParser, async (req, res) => {
    try {
        // Gather text configuration options from query parameters or JSON body.
        // Merge both sources so POST body and GET query params both work;
        // req.query takes precedence if a key appears in both.
        const { data, size, theme, banner: queryBanner } = { ...req.body, ...req.query };

        if (!data) {
            return res.status(400).json({ error: "The 'data' query or body parameter is required." });
        }

        if (data.length > 1200) {
            return res.status(400).json({ error: "Data payload is too large. Maximum length allowed is 1200 characters." });
        }

        let qrSize = 500;
        if (size !== undefined && size !== null && size !== '') {
            // Accept either a plain number (600) or a "WxH" string ("600x600")
            const w = parseInt(typeof size === 'number' ? size : String(size).split('x')[0], 10);
            if (!isNaN(w) && w > 0) qrSize = w;
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

        // Custom Geometry Drawing Methods
        function drawRoundedRect(x, y, w, h, r) {
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
            } else {
                drawRoundedRect(x + innerPad, y + innerPad, innerSize, innerSize, moduleSize * 0.5);
            }
        }

        const finderZones = [[0, 0], [moduleCount - 7, 0], [0, moduleCount - 7]];
        const bannerMatrixSize = Math.floor(moduleCount * 0.22);
        const centerStart = Math.floor((moduleCount - bannerMatrixSize) / 2);
        const centerEnd = centerStart + bannerMatrixSize;

        // Matrix Rendering Loop
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
                    }
                }
            }
        }

        // Top Layer Finders
        drawFinder(0, 0);
        drawFinder(moduleCount - 7, 0);
        drawFinder(0, moduleCount - 7);

        // Banner Detection: Try to locate a valid binary or base64 asset
        let bannerBuffer = null;
        let hasImageBanner = false;

        // Is it uploaded as a raw binary image in req.body?
        if (Buffer.isBuffer(req.body) && req.body.length > 0) {
            bannerBuffer = req.body;
        }
        // Was it sent as a Base64 string inside the query parameter?
        else if (queryBanner) {
            const rawBase64 = queryBanner.startsWith('data:image') ? queryBanner.split(',')[1] : queryBanner;
            const cleanBase64 = rawBase64.trim().replace(/ /g, '+');
            bannerBuffer = Buffer.from(cleanBase64, 'base64');
        }

        // Process image banner buffer if discovered
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
            const badgeSize = qrSize * 0.21;
            const centerPos = (qrSize - badgeSize) / 2;
            const centerCoord = qrSize / 2;

            ctx.fillStyle = bgColour;
            drawRoundedRect(centerPos, centerPos, badgeSize, badgeSize, activeTheme ? moduleSize * 1.2 : moduleSize * 0.8);

            const textMainColor = activeTheme ? '#FFFFFF' : '#000000';
            let textSubColor = '#444444';
            if (activeTheme) {
                if (theme.toLowerCase() === 'cyber') textSubColor = '#ec4899';
                else if (theme.toLowerCase() === 'tokyonight') textSubColor = '#bb9af7';
                else if (theme.toLowerCase() === 'neon') textSubColor = '#00ffcc';
            }

            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            ctx.font = '700 32px "Geist Mono", monospace';
            ctx.fillStyle = textMainColor;
            ctx.fillText('QR', centerCoord, centerCoord - 12);

            ctx.font = '1000 20px "Geist Mono", monospace';
            ctx.fillStyle = textSubColor;
            ctx.fillText('Codify', centerCoord, centerCoord + 18);
        }

        const buffer = canvas.toBuffer('image/png');
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

        // Handle Input Formats
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

        // Load Image into Canvas to get raw RGBA pixels
        const image = await loadImage(imageBuffer);
        const canvas = createCanvas(image.width, image.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0, image.width, image.height);

        const imageData = ctx.getImageData(0, 0, image.width, image.height);
        const argbLen = imageData.width * imageData.height;
        const luminancePoints = new Uint8ClampedArray(argbLen);

        // Convert RGBA to Grayscale Luminance values for ZXing
        for (let i = 0; i < argbLen; i++) {
            const r = imageData.data[i * 4];
            const g = imageData.data[i * 4 + 1];
            const b = imageData.data[i * 4 + 2];
            // Standard luminance conversion formula
            luminancePoints[i] = (r * 0.2126 + g * 0.7152 + b * 0.0722);
        }

        //  Setup ZXing Reader with high-performance configurations
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);
        hints.set(DecodeHintType.TRY_HARDER, true); // Tells ZXing to spend more CPU cycles parsing complex styles

        const reader = new MultiFormatReader();
        reader.setHints(hints);

        const luminanceSource = new RGBLuminanceSource(luminancePoints, imageData.width, imageData.height);
        const binaryBitmap = new BinaryBitmap(new HybridBinarizer(luminanceSource));

        // Decode the matrix
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
        // ZXing throws an error when it can't find a barcode, map it to a readable message
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

// 404 handler: API routes return JSON, browser routes use the EJS page
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