#!/usr/bin/env bun

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

interface UserScriptOptions {
	name?: string;
	namespace?: string;
	version?: string;
	description?: string;
	author?: string;
	homepage?: string;
	icon?: string;
	match?: string[];
	include?: string[];
	exclude?: string[];
	require?: string[];
	grant?: string[];
	"run-at"?: string;
	connect?: string[];
	noframes?: boolean;
}

interface PackageJson {
	name: string;
	version: string;
	description?: string;
	author?: string;
	homepage?: string;
	userscript?: UserScriptOptions;
}

function generateHeader(pkg: PackageJson): string {
	const userscript = pkg.userscript || {};
	const headers = ["// ==UserScript=="];

	headers.push(`// @name         ${userscript.name || pkg.name}`);
	headers.push(`// @version      ${userscript.version || pkg.version}`);

	if (userscript.namespace) {
		headers.push(`// @namespace    ${userscript.namespace}`);
	}
	if (pkg.description || userscript.description) {
		headers.push(`// @description  ${userscript.description || pkg.description}`);
	}
	if (pkg.author || userscript.author) {
		headers.push(`// @author       ${userscript.author || pkg.author}`);
	}
	if (pkg.homepage || userscript.homepage) {
		headers.push(`// @homepage     ${userscript.homepage || pkg.homepage}`);
	}
	if (userscript.icon) {
		headers.push(`// @icon         ${userscript.icon}`);
	}

	if (userscript.match) {
		userscript.match.forEach(pattern => {
			headers.push(`// @match        ${pattern}`);
		});
	}
	if (userscript.include) {
		userscript.include.forEach(pattern => {
			headers.push(`// @include      ${pattern}`);
		});
	}
	if (userscript.exclude) {
		userscript.exclude.forEach(pattern => {
			headers.push(`// @exclude      ${pattern}`);
		});
	}

	if (userscript.require) {
		userscript.require.forEach(req => {
			headers.push(`// @require      ${req}`);
		});
	}

	if (userscript.grant) {
		userscript.grant.forEach(grant => {
			headers.push(`// @grant        ${grant}`);
		});
	}

	if (userscript.connect) {
		userscript.connect.forEach(domain => {
			headers.push(`// @connect      ${domain}`);
		});
	}

	if (userscript["run-at"]) {
		headers.push(`// @run-at       ${userscript["run-at"]}`);
	}

	if (userscript.noframes) {
		headers.push("// @noframes");
	}

	headers.push("// ==/UserScript==");
	headers.push("");
	return headers.join("\n");
}

async function build(watch = false) {
	try {
		const pkgPath = join(process.cwd(), "package.json");
		const pkg: PackageJson = JSON.parse(readFileSync(pkgPath, "utf-8"));

		const distDir = join(process.cwd(), "dist");
		mkdirSync(distDir, { recursive: true });

		console.log(`Building userscript${watch ? " (watch mode)" : ""}...`);

		// build w/ bun
		const result = await Bun.build({
			entrypoints: ["./src/index.ts"],
			outdir: "./dist",
			target: "browser",
			format: "esm",
			minify: false,
			sourcemap: "none",
		});

		if (!result.success) {
			console.error("Build failed:");
			result.logs.forEach(log => console.error(log));
			process.exit(1);
		}

		// Read the built file
		const builtFile = join(distDir, "index.js");
		let builtCode = readFileSync(builtFile, "utf-8");

		// Transform ESM exports to work with our IIFE wrapper
		// Replace "export { ... }" with direct assignments to exports object
		const exportMatch = builtCode.match(/export\s*\{[\s\S]*?\};/);
		if (exportMatch) {
			const exportBlock = exportMatch[0];
			const exportList = exportBlock
				.replace(/export\s*\{/, "")
				.replace(/\};?$/, "")
				.trim();

			const assignments = exportList
				.split(",")
				.map((exp: string) => {
					const parts = exp.trim().split(/\s+as\s+/);
					const [source, alias] = parts.length === 2 ? parts : [parts[0], parts[0]];
					return `exports.${alias.trim()} = ${source.trim()};`;
				})
				.join("\n");

			builtCode = builtCode.replace(exportBlock, assignments);
		}

		// Wrap in IIFE and expose to window._spitroast
		const wrappedCode = `(function() {
  const exports = {};
  
${builtCode}

  window._spitroast = exports;
})();`;

		// Generate userscript header
		const header = generateHeader(pkg);

		// Combine header and code
		const userscript = header + wrappedCode;

		// Write userscript file (remove .user.js from name if it already exists)
		const baseName = pkg.name.replace(/\.user$/, "");
		const userscriptPath = join(distDir, `${baseName}.user.js`);
		writeFileSync(userscriptPath, userscript);

		console.log(`Userscript built to ${userscriptPath}`);

		if (watch) {
			console.log("Watching for changes");
			// Bun watch implementation
			const watcher = Bun.watch(join(process.cwd(), "src"));
			for await (const event of watcher) {
				console.log(`Rebuilding...`);
				await build(false);
			}
		}
	} catch (error) {
		console.error(error);
		process.exit(1);
	}
}

// Check for watch flag
const watch = process.argv.includes("--watch") || process.argv.includes("-w");
build(watch);
