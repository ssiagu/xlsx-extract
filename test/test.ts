import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';
import {assert, should, expect, use} from 'chai';
import chaiExclude = require('chai-exclude');
import {describe, it} from 'mocha';
import {Sheet} from '../src/lib/sheet';
import {XLSX} from '../src';
import {IXLSXExtractOptions} from '../src/types';
import {Cell} from '../src/lib/cell';
import tmp from 'tmp';

use(chaiExclude);

const parsers: Array<string> = [
	'sax',
	'expat',
];
const testfiles: Array<string> = [
	'test.xlsx',
	'inlinestr.xlsx',
	'fake.xlsx',
];

interface IXLSXSpecCell {
	raw?: string;
	val?: any;
}

interface IXLSXSpecSheet {
	nr: string;
	name: string;
	rid: string;
	rows: Array<Array<IXLSXSpecCell>>;
}

interface IXLSXSpec {
	description: string;
	sheets?: Array<IXLSXSpecSheet>;
	error?: boolean;
}

interface IXLSXDataSheet extends Sheet {
	rows: Array<{ cells: Array<Cell> }>;
}

interface IXLSXData {
	sheets: Array<IXLSXDataSheet>;
}


function convertToTsv(filename: string, options: IXLSXExtractOptions, cb: (err: Error | null, tsv?: string) => void) {
	const file = tmp.fileSync();
	fs.unlinkSync(file.name);
	let error: Error | null = null;
	new XLSX().convert(filename, file.name, options)
		.on('end', () => {
			const exists = fs.existsSync(file.name);
			assert.equal(exists, true, 'file not written');
			if (exists) {
				const tsv = fs.readFileSync(file.name).toString();
				file.removeCallback();
				cb(error, tsv);
			} else {
				cb(error);
			}

		})
		.on('error', err => {
			error = err;
		});
}

function readFile(filename: string, options: IXLSXExtractOptions, cb: (err: Error | null, xlsx?: IXLSXData) => void) {
	const xlsx: IXLSXData = {
		sheets: []
	};

	let error: Error | null = null;
	new XLSX().extract(filename, Object.assign({format: 'obj', include_empty_rows: true}, options))
		.on('sheet', sheet => {
			sheet.rows = [];
			xlsx.sheets.push(sheet);
		})
		.on('row', row => {
			if (xlsx.sheets.length > 0) {
				xlsx.sheets[xlsx.sheets.length - 1].rows.push(row);
			}
		})
		.on('end', () => {
			cb(error, xlsx);
		})
		.on('error', err => {
			error = err;
		});
}

function compareSheet(specsheet: IXLSXSpecSheet, sheet?: IXLSXDataSheet) {
	should().exist(sheet);
	if (!sheet) {
		return;
	}
	expect(sheet).excluding(['rows']).to.deep.equal(specsheet, 'Sheets not equal');
	assert.equal(sheet.rows.length, specsheet.rows ? specsheet.rows.length : 0, 'Invalid sheet row count');
	if (!specsheet.rows) {
		return;
	}
	specsheet.rows.forEach((specrow, index) => {
		const sheetrow = sheet.rows[index].cells.map((cell: Cell) => {
			const def: IXLSXSpecCell = {};
			if (cell.raw) {
				def.raw = cell.raw;
			}
			if (cell.val !== cell.raw) {
				def.val = cell.val;
				if (util.types.isDate(def.val)) {
					def.val = def.val.toISOString();
				}
			}
			return def;
		});
		expect(sheetrow).to.deep.equal(specrow, 'Row not equal');
	});
	// console.log(JSON.stringify(
	// 	row.cells.map((cell: Cell) => {
	// 		return {raw: cell.raw, val: cell.val !== cell.raw ? cell.val : undefined};
	// 	})
	// ));

}

function compareSpec(xlsx: IXLSXData, spec: IXLSXSpec) {
	const specsheets = (spec.sheets || []);
	assert.equal(xlsx.sheets.length, specsheets.length, 'Invalid sheet count');
	specsheets.forEach((specsheet) => {
		compareSheet(specsheet, xlsx.sheets.find(s => s.nr === specsheet.nr));
	});
}

function compareSingleSpec(xlsx: IXLSXData, specsheet: IXLSXSpecSheet) {
	assert.equal(xlsx.sheets.length, 1, 'Invalid sheet count, should be 1');
	compareSheet(specsheet, xlsx.sheets[0]);
}

function defToTSV(specSheet: IXLSXSpecSheet, options: IXLSXExtractOptions) {
	return (specSheet.rows || []).map(row => {
		return row.map(cell => {
			return cell.val !== undefined ? cell.val : cell.raw;
		}).join(options.tsv_delimiter);
	}).join(options.tsv_endofline) + options.tsv_endofline;
}

describe('xlsx', function() {
	this.timeout(10000);
	parsers.forEach(parser => {
		describe(parser, () => {
			testfiles.forEach(testfile => {
				const sourcefile = path.join(__dirname, 'data', testfile);
				const spec: IXLSXSpec = JSON.parse(fs.readFileSync(sourcefile + '.spec.json').toString());
				if (spec.error) {
					describe(spec.description + ' - ' + testfile, () => {
						it('should fail according to spec', done => {
							readFile(sourcefile, {sheet_all: true, parser}, (err, xlsx) => {
								should().exist(err);
								done();
							});
						});
					});
				} else {
					describe(spec.description + ' - ' + testfile, () => {
						it('should read and compare according to spec', done => {
							readFile(sourcefile, {sheet_all: true, parser}, (err, xlsx) => {
								should().not.exist(err);
								should().exist(xlsx);
								if (!xlsx) {
									return done();
								}
								compareSpec(xlsx, spec);
								done();
							});
						});
						(spec.sheets || []).forEach(specSheet => {
							it('should read the sheet ' + specSheet.nr + ' by number: ' + specSheet.nr, done => {
								readFile(sourcefile, {sheet_nr: specSheet.nr, parser}, (err, xlsx) => {
									should().not.exist(err);
									should().exist(xlsx);
									if (!xlsx) {
										return done();
									}
									compareSingleSpec(xlsx, specSheet);
									done();
								});
							});
							it('should read the sheet ' + specSheet.nr + ' by name: ' + specSheet.name, done => {
								readFile(sourcefile, {sheet_name: specSheet.name, parser}, (err, xlsx) => {
									should().not.exist(err);
									should().exist(xlsx);
									if (!xlsx) {
										return done();
									}
									compareSingleSpec(xlsx, specSheet);
									done();
								});
							});
							it('should read the sheet ' + specSheet.nr + ' by id: ' + specSheet.rid, done => {
								readFile(sourcefile, {sheet_id: specSheet.rid, parser}, (err, xlsx) => {
									should().not.exist(err);
									should().exist(xlsx);
									if (!xlsx) {
										return done();
									}
									compareSingleSpec(xlsx, specSheet);
									done();
								});
							});
							it('should read the sheet ' + specSheet.nr + ' ignoring the first line', done => {
								readFile(sourcefile, {sheet_id: specSheet.rid, ignore_header: 1, parser}, (err, xlsx) => {
									should().not.exist(err);
									should().exist(xlsx);
									if (!xlsx) {
										return done();
									}
									const specSheetLimited: IXLSXSpecSheet = {
										nr: specSheet.nr,
										name: specSheet.name,
										rid: specSheet.rid,
										rows: specSheet.rows ? specSheet.rows.slice(1) : []
									};
									compareSingleSpec(xlsx, specSheetLimited);
									done();
								});
							});
							it('should read the sheet ' + specSheet.nr + ' ignoring the two lines', done => {
								readFile(sourcefile, {sheet_id: specSheet.rid, ignore_header: 2, parser}, (err, xlsx) => {
									should().not.exist(err);
									should().exist(xlsx);
									if (!xlsx) {
										return done();
									}
									const specSheetLimited: IXLSXSpecSheet = {
										nr: specSheet.nr,
										name: specSheet.name,
										rid: specSheet.rid,
										rows: specSheet.rows ? specSheet.rows.slice(2) : []
									};
									compareSingleSpec(xlsx, specSheetLimited);
									done();
								});
							});
							it('should read the sheet ' + specSheet.nr + ' with empty rows filtered', done => {
								readFile(sourcefile, {sheet_id: specSheet.rid, include_empty_rows: false, parser}, (err, xlsx) => {
									should().not.exist(err);
									should().exist(xlsx);
									if (!xlsx) {
										return done();
									}
									const specSheetLimited: IXLSXSpecSheet = {
										nr: specSheet.nr,
										name: specSheet.name,
										rid: specSheet.rid,
										rows: specSheet.rows ? specSheet.rows.filter(r => r.length > 0) : []
									};
									compareSingleSpec(xlsx, specSheetLimited);
									done();
								});
							});
							it('should read the sheet ' + specSheet.nr + ' ignoring the first line and empty rows filtered', done => {
								readFile(sourcefile, {sheet_id: specSheet.rid, ignore_header: 1, include_empty_rows: false, parser}, (err, xlsx) => {
									should().not.exist(err);
									should().exist(xlsx);
									if (!xlsx) {
										return done();
									}
									const specSheetLimited: IXLSXSpecSheet = {
										nr: specSheet.nr,
										name: specSheet.name,
										rid: specSheet.rid,
										rows: specSheet.rows ? specSheet.rows.filter(r => r.length > 0).slice(1) : []
									};
									compareSingleSpec(xlsx, specSheetLimited);
									done();
								});
							});
							it('should read the sheet ' + specSheet.nr + ' ignoring the first two lines and empty rows filtered', done => {
								readFile(sourcefile, {sheet_id: specSheet.rid, ignore_header: 2, include_empty_rows: false, parser}, (err, xlsx) => {
									should().not.exist(err);
									should().exist(xlsx);
									if (!xlsx) {
										return done();
									}
									const specSheetLimited: IXLSXSpecSheet = {
										nr: specSheet.nr,
										name: specSheet.name,
										rid: specSheet.rid,
										rows: specSheet.rows ? specSheet.rows.filter(r => r.length > 0).slice(2) : []
									};
									compareSingleSpec(xlsx, specSheetLimited);
									done();
								});
							});
							it('should convert to tsv', done => {
								const options: IXLSXExtractOptions = {
									sheet_id: specSheet.rid, include_empty_rows: true,
									tsv_delimiter: '\t', tsv_endofline: '\n', tsv_float_comma: false,
									parser
								};
								convertToTsv(sourcefile, options, (err, tsv) => {
									should().not.exist(err);
									should().exist(tsv);
									assert.equal(tsv, defToTSV(specSheet, options), 'Invalid tsv');
									done();
								});
							});

						});

					});
				}
			});
		});
	});

});
