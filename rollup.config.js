import { nodeResolve } from "@rollup/plugin-node-resolve";
import { terser } from "rollup-plugin-terser";
import babel from "@rollup/plugin-babel";
import pkg from "./package.json";
import commonjs from 'rollup-plugin-commonjs';
import nodePolyfills from "rollup-plugin-node-polyfills";
import builtins from "rollup-plugin-node-globals";


const input = ["src/index.js"];

export default [
    {
        // UMD
        input,
        plugins: [
            nodeResolve({
                browser: true
            }),
            commonjs(),
            babel({
                babelHelpers: "runtime",
                //exclude: 'node_modules/**', // only transpile our source code
                presets: ["@babel/preset-env"],
                plugins: [
                    "@babel/transform-runtime",
                    "@babel/transform-regenerator",
                    "@babel/transform-async-to-generator",
                ]
            }),
            terser(),
            builtins(),
            nodePolyfills()
        ],
        output: {
            //file: `dist/${pkg.name}.min.js`,
            file: "dist/regira.min.js",
            format: "umd",
            name: "regira", // this is the name of the global object
            esModule: false,
            exports: "named",
            sourcemap: true
        },
    },
    // ESM and CJS
    {
        input,
        plugins: [
            nodeResolve(),
            commonjs()
        ],
        output: [
            {
                dir: "dist/esm",
                format: "esm",
                exports: "named",
                sourcemap: true,
            },
            {
                // root esm
                file: "index.js",
                format: "esm",
                exports: "named",
                sourcemap: true,
            },
            {
                dir: "dist/cjs",
                format: "cjs",
                exports: "named",
                sourcemap: true,
            },
        ],
    },
];