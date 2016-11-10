import utf8 from "utf8";
import fetch from "../actions/xhr";
import styles from "../components/App.css";
import * as utils from "./index";
import _ from "lodash";
import EventLogger from "../analytics/EventLogger";

// addAnnotations is the entry point for injecting annotations onto a blob (el).
// An invisible marker is appended to the document to indicate that annotation
// has been completed; so this function expects that it will be called once all
// repo/annotation data is resolved from the server.
export default function addAnnotations(path, repoRevSpec, el, anns, lineStartBytes, isSplitDiff, loggingStruct) {
	_applyAnnotations(el, path, repoRevSpec, indexAnnotations(anns).annsByStartByte, indexLineStartBytes(lineStartBytes), isSplitDiff, loggingStruct);
}

// _applyAnnotations is a helper function for addAnnotations
export function _applyAnnotations(el, path, repoRevSpec, annsByStartByte, startBytesByLine, isSplitDiff, loggingStruct) {
	// The blob is represented by a table; the first column is the line number,
	// the second is code. Each row is a line of code
	const table = el.querySelector("table");

	let cells = [];
	for (let i = 0; i < table.rows.length; ++i) {
		const row = table.rows[i];

		// Inline comments from single comment / review of a Pull request
		if (row.classList && row.classList.contains("inline-comments")) continue;

		// line: line number of the current line
		// codeCell: The actual table cell that has code inside.
		//           Each row contains multiple columns, for
		//           line number and code (multiple in diffs).
		let line, codeCell;
		if (repoRevSpec.isDelta) {
			if (isSplitDiff && row.cells.length !== 4) continue;

			// metaCell contains either the line number or the blob expander for common parts in a diff
			let metaCell;
			if (isSplitDiff) {
				metaCell = repoRevSpec.isBase ? row.cells[0] : row.cells[2];
			} else {
				metaCell = repoRevSpec.isBase ? row.cells[0] : row.cells[1];
			}

			if (metaCell.classList && metaCell.classList.contains("blob-num-expandable")) {
				continue;
			}

			if (isSplitDiff) {
				codeCell = repoRevSpec.isBase ? row.cells[1] : row.cells[3];
			} else {
				codeCell = row.cells[2];
			}

			if (!codeCell) {
				continue;
			}

			if (codeCell.classList && codeCell.classList.contains("blob-code-empty")) {
				continue;
			}

			let isAddition = codeCell.classList && codeCell.classList.contains("blob-code-addition");
			let isDeletion = codeCell.classList && codeCell.classList.contains("blob-code-deletion");
			// Mark the tokens for common lines using start/end bytes from head
			// Head is preferred over base because with the ?w=1 parameter on
			// Github, changes that only affect whitespace are hidden by using
			// line data from head which leads to wrong byte offsets for the tokens.
			if (!isAddition && !isDeletion && repoRevSpec.isBase && !isSplitDiff) {
				continue; // careful; we don't need to put head AND base on unmodified parts (but only for unified diff views)
			}
			if (isDeletion && !repoRevSpec.isBase) {
				continue;
			}
			if (isAddition && repoRevSpec.isBase) {
				continue;
			}

			line = metaCell.dataset.lineNumber;
			if (line === "..." || !line) {
				continue;
			}
		} else {
			line = row.cells[0].dataset.lineNumber;
			codeCell = row.cells[1];
		}

		const isInner = codeCell.querySelector(".blob-code-inner");
		const curLine = isInner || codeCell; // DOM node of the "line"

		// If the line has already been annotated,
		// restore event handlers if necessary otherwise move to next line
		if (el.dataset[`${line}_${repoRevSpec.rev}`]) {
			if (!el.onclick || !el.onmouseout || !el.onmouseover) {
				addEventListeners(curLine, path, repoRevSpec, line, loggingStruct);
			}
			continue;
		}
		el.dataset[`${line}_${repoRevSpec.rev}`] = true;

		// parse, annotate and replace the node asynchronously.
		setTimeout(() => {
			const annLine = convertNode(curLine, annsByStartByte, startBytesByLine[line], startBytesByLine[line], repoRevSpec.isDelta);

			curLine.innerHTML = "";
			curLine.appendChild(annLine.resultNode);

			addEventListeners(curLine, path, repoRevSpec, line, loggingStruct);
		});
	}
}

// indexAnnotations creates a fast lookup structure optimized to query
// annotations by start or end byte.
export function indexAnnotations(anns) {
	let annsByStartByte = {};
	let annsByEndByte = {};
	for (let i = 0; i < anns.length; i++) {
		// From pkg/syntaxhighlight/html_annotator.go
		const annType = anns[i].Class;
		if (annType !== "com" && annType !== "lit" && annType !== "pun" && annType !== "kwd" && annType !== "str") {
			let ann = anns[i];
			annsByStartByte[ann.StartByte] = ann;
			annsByEndByte[ann.EndByte] = ann;
		}
	}
	return {annsByStartByte, annsByEndByte};
}

// indexLineStartBytes creates a fast lookup structure optimized to query
// byte offsets by line number (1-indexed).
export function indexLineStartBytes(lineStartBytes) {
	let startBytesByLine = {};
	for (let i = 0; i < lineStartBytes.length; i++) {
		startBytesByLine[i + 1] = lineStartBytes[i];
	}
	return startBytesByLine;
}

// isStringNode and isCommentNode are predicate functions to
// identify string identifier DOM elements, as per Github's code styling classes.
export function isCommentNode(node) {
	return node.classList.contains("pl-c");
}

// isStringNode should skip any string that might have
// have an eval statement within that must be annotated
export function isStringNode(node) {
	return node.classList.contains("pl-s") && node.childNodes.length === 3 && node.childNodes[0].classList.contains("pl-pds") && node.childNodes[2].classList.contains("pl-pds");
}

// convertNode takes a DOM node and returns an object containing the
// maybe-linkified version of the node as an HTML string as well as the number of bytes consumed.
// It is the entry point for converting a <td> "cell" representing a line of code.
// It may also be called recursively for children (which are assumed to be <span>
// code highlighting annotations from GitHub).
export function convertNode(currentNode, annsByStartByte, offset, lineStart, ignoreFirstTextChar) {
	let wrapperNode, c; // c is an intermediate result

	if (currentNode.nodeType === Node.TEXT_NODE) {
		c = convertTextNode(currentNode, annsByStartByte, offset, lineStart, ignoreFirstTextChar);
	} else if (currentNode.nodeType === Node.ELEMENT_NODE) {
		c = isStringNode(currentNode) || isCommentNode(currentNode) ?
			convertStringNode(currentNode, annsByStartByte, offset, lineStart) :
			convertElementNode(currentNode, annsByStartByte, offset, lineStart, ignoreFirstTextChar);
	} else {
		throw new Error(`unexpected node type(${currentNode.nodeType})`);
	}

	// If this is the top level node for code, return a documentFragment
	// otherwise copy all the attributes of the original node.
	if (currentNode.tagName === "TD") {
		wrapperNode = document.createDocumentFragment();
		wrapperNode.appendChild(c.resultNode);
	} else {
		wrapperNode = c.resultNode;
		if (currentNode.attributes && currentNode.attributes.length > 0) {
			[].map.call(currentNode.attributes, (attr) => {wrapperNode.setAttribute(attr.name, attr.value)});
		}
	}

	return {
		resultNode: wrapperNode,
		bytesConsumed: c.bytesConsumed,
	};
}

// convertTextNode takes a DOM node which should be of NodeType.TEXT_NODE
// (this must be checked by the caller) and returns an object containing the
//  maybe-linkified version of the node as an HTML string and the number
// of bytes consumed.
export function convertTextNode(currentNode, annsByStartByte, offset, lineStart, ignoreFirstTextChar) {
	let nodeText;
	let prevConsumed = 0;
	let bytesConsumed = 0;
	let lineOffset = offset;
	const wrapperNode = document.createElement("SPAN");
	wrapperNode.id = `text-node-wrapper-${lineOffset}`; // TODO(john): this is not globally unique for diff views.

	function createTextNode(nodeText, start, end, offset) {
		const wrapNode = document.createElement("SPAN");
		wrapNode.id = `text-node-${lineOffset}-${offset}`; // TODO(john): this is not globally unique for diff views.
		const textNode = document.createTextNode(utf8.decode(nodeText.slice(start, end).join("")));

		wrapNode.dataset.byteoffset = offset;
		wrapNode.appendChild(textNode);

		return wrapNode;
	}

	// Text could contain escaped character sequences (e.g. "&gt;") or UTF-8
	// decoded characters (e.g. "˟") which need to be properly counted in terms of bytes.
	nodeText = utf8.encode(_.unescape(currentNode.textContent)).split("");

	// Handle special case for pull requests (+/- character on diffs).
	if (ignoreFirstTextChar && nodeText.length > 0) {
		wrapperNode.appendChild(document.createTextNode(utf8.decode(nodeText[0])));
		nodeText = nodeText.slice(1);
	}

	for (bytesConsumed = 0; bytesConsumed < nodeText.length;) {
		const match = annsByStartByte[offset + bytesConsumed];

		if (match) {
			if (prevConsumed < bytesConsumed) {
				// Consume the bytes that have been passed from no matches into a single text node.
				wrapperNode.appendChild(createTextNode(nodeText, prevConsumed, bytesConsumed, offset + prevConsumed + 1 - lineStart));
				prevConsumed = bytesConsumed;
			}

			bytesConsumed += (match.EndByte - match.StartByte);
			wrapperNode.appendChild(createTextNode(nodeText, prevConsumed, bytesConsumed, offset + prevConsumed + 1 - lineStart));
			prevConsumed = bytesConsumed;
		} else {
			bytesConsumed++;
		}
	}

	if (prevConsumed < bytesConsumed) {
		wrapperNode.appendChild(createTextNode(nodeText, prevConsumed, bytesConsumed, offset + prevConsumed + 1 - lineStart));
	}

	return {resultNode: wrapperNode, bytesConsumed};
}

// convertStringNode takes a DOM node which is a plain string and returns an object containing the
// maybe-linkified version of the node as an HTML string as well as the number of bytes consumed.
export function convertStringNode(currentNode, annsByStartByte, offset, lineStart) {
	const wrapperNode = document.createElement("SPAN");

	wrapperNode.dataset.byteoffset = offset + 1 - lineStart;
	wrapperNode.appendChild(currentNode.cloneNode(true));

	return {
		resultNode: wrapperNode,
		bytesConsumed: currentNode.textContent.length
	}
}

// convertElementNode takes a DOM node which should be of NodeType.ELEMENT_NODE
// (this must be checked by the caller) and returns an object containing the
//  maybe-linkified version of the node as an HTML string as well as the number of bytes consumed.
export function convertElementNode(currentNode, annsByStartByte, offset, lineStart, ignoreFirstTextChar) {
	let bytesConsumed = 0;
	const wrapperNode = document.createElement("SPAN");

	wrapperNode.dataset.byteoffset = offset + 1 - lineStart;
	// The logic here is to simply recurse on each of the child nodes; everything is eventually
	// just a text node or the special-cased "quoted string node" (see below).
	for (let i = 0; i < currentNode.childNodes.length; ++i) {
		const res = convertNode(currentNode.childNodes[i], annsByStartByte, offset + bytesConsumed, lineStart, i === 0 && ignoreFirstTextChar);
		wrapperNode.appendChild(res.resultNode);
		bytesConsumed += res.bytesConsumed;
	}

	return {resultNode: wrapperNode, bytesConsumed};
}

// The rest of this file is responsible for fetching/caching annotation specific data from the server
// and adding interaction tooltip data to annotated elements.
// The sate management is done outside of the Redux container, thought it could be there; some of this
// stuff we don't need synchonized to browser local storage.

let tooltipCache = {};
let j2dCache = {};

const HOVER_DELAY_MS = 200;

const tooltip = document.createElement("DIV");
tooltip.classList.add(styles.tooltip);
tooltip.classList.add("sg-tooltip");

const loadingTooltip = document.createElement("DIV");
loadingTooltip.appendChild(document.createTextNode("Loading..."));

let activeTarget;
function getTarget(t) {
	while (t && t.tagName !== "TD" && !t.dataset && !t.dataset.byteoffset) {t = t.parentNode;}
	if (t && t.tagName === "SPAN" && t.dataset && t.dataset.byteoffset) return t;
}

let hoverTimeout;
function clearTooltip() {
	clearTimeout(hoverTimeout);
	if (tooltip.firstChild) {
		tooltip.removeChild(tooltip.firstChild);
	}
	tooltip.style.visibility = "hidden"; // prevent black dot of empty content
}

function addEventListeners(el, path, repoRevSpec, line, loggingStruct) {
	el.onclick = function(e) {
		let t = getTarget(e.target);
		if (!t || t.style.cursor !== "pointer") return;

		let openInNewTab = e.ctrlKey || (navigator.platform.toLowerCase().indexOf("mac") >= 0 && e.metaKey) || e.button === 1;

		fetchJumpURL(t.dataset.byteoffset, function(defUrl) {
			if (!defUrl) {
				return;
			}

			// If cmd/ctrl+clicked or middle button clicked, open in new tab/page otherwise
			// either move to a line on the same page, or refresh the page to a new blob view.
			EventLogger.logEventForCategory("Def", "Click", "JumpDef", Object.assign({}, repoRevSpec, loggingStruct));
			window.open(defUrl, "_blank");
		});
	}

	el.onmouseout = function(e) {
		clearTooltip();
		activeTarget = null;
	};

	el.onmouseover = function(e) {
		let t = getTarget(e.target);
		if (!t) return;

		if (activeTarget !== t) {
			activeTarget = t;
			clearTooltip();
			// Only show "Loading..." if it has been loading for a while. If we
			// show "Loading..." immediately, there will be a visible flash if
			// the actual hover text loads quickly thereafter.
			hoverTimeout = setTimeout(() => showTooltip(loadingTooltip, true, loggingStruct), 3 * HOVER_DELAY_MS);

			const hoverShowTime = Date.now() + HOVER_DELAY_MS;
			getTooltip(activeTarget, function(elem) {
				clearTimeout(hoverTimeout); // prevent delayed addition of loading indicator
				if (elem === null) { // add no tooltip for empty responses
					return;
				}

				// Always wait at least HOVER_DELAY_MS before showing hover, to avoid
				// it obscuring text when you move your mouse rapidly across a code file.
				const hoverTimerRemaining = Math.max(0, hoverShowTime - Date.now());
				hoverTimeout = setTimeout(() => showTooltip(elem, false, loggingStruct), hoverTimerRemaining);
			});
		}
	}

	function showTooltip(elem, isLoading, loggingStruct) {
		clearTooltip();

		if (activeTarget && elem) {
			// Log event only when displaying a fetched tooltip
			if (!isLoading) {
				EventLogger.logEventForCategory("Def", "Hover", "HighlightDef", Object.assign({}, repoRevSpec, loggingStruct));
			}

			tooltip.appendChild(elem);

			// Hide the tooltip initially while we add it to DOM to render and generate
			// bounding rectangle but hide as we haven't anchored it to a position yet.
			tooltip.style.visibility = "hidden";

			// Anchor it horizontally, prior to rendering to account for wrapping
			// changes to vertical height if the tooltip is at the edge of the viewport.
			const activeTargetBound = activeTarget.getBoundingClientRect();
			tooltip.style.left = (activeTargetBound.left + window.scrollX) + "px";

			// Attach the node to DOM so the bounding rectangle is generated.
			document.body.appendChild(tooltip);

			// Anchor the tooltip vertically.
			const tooltipBound = tooltip.getBoundingClientRect();
			tooltip.style.top = (activeTargetBound.top - (tooltipBound.height + 5) + window.scrollY) + "px";

			// Make it all visible to the user.
			tooltip.style.visibility = "visible";
		}
	}

	function wrapLSP(req) {
		req.id = 1;
		return [
			{
				id: 0,
				method: "initialize",
				params: {
					rootPath: `git://${repoRevSpec.repoURI}?${repoRevSpec.rev}`,
					mode: `${utils.getModeFromExtension(utils.getPathExtension(path))}`,
				},
			},
			req,
			{
				id: 2,
				method: "shutdown",
			},
			{
				method: "exit",
			},
		];
	}

	function fetchJumpURL(col, cb) {
		const cacheKey = `${path}@${repoRevSpec.rev}:${line}@${col}`;
		if (typeof j2dCache[cacheKey] !== "undefined") {
			return cb(j2dCache[cacheKey]);
		}

		const body = wrapLSP({
			method: "textDocument/definition",
			params: {
				textDocument: {
					uri: `git://${repoRevSpec.repoURI}?${repoRevSpec.rev}#${path}`,
				},
				position: {
					character: parseInt(col, 10) - 1,
					line: parseInt(line, 10) - 1,
				},
			},
		});

		return fetch("https://sourcegraph.com/.api/xlang/textDocument/definition", {method: "POST", body: JSON.stringify(body)})
			.then((resp) => resp.json().then((json) => {
				const respUri = json[1].result[0].uri.split("git://")[1];
				const prt0Uri = respUri.split("?");
				const prt1Uri = prt0Uri[1].split("#");

				const repoUri = prt0Uri[0];
				const frevUri = (repoUri === repoRevSpec.repoURI ? repoRevSpec.relRev : prt1Uri[0]) || "master";
				const pathUri = prt1Uri[1];
				const lineUri = parseInt(json[1].result[0].range.start.line, 10) + 1;

				j2dCache[cacheKey] = `https://sourcegraph.com/${repoUri}@${frevUri}/-/blob/${pathUri}${lineUri ? "#L" + lineUri : ""}`;
				cb(j2dCache[cacheKey]);
			})).catch((err) => cb(null));
	}

	function getTooltip(target, cb) {
		const cacheKey = `${path}@${repoRevSpec.rev}:${line}@${target.dataset.byteoffset}`;
		if (typeof tooltipCache[cacheKey] !== "undefined") {
			return cb(tooltipCache[cacheKey]);
		}

		const body = wrapLSP({
			method: "textDocument/hover",
			params: {
				textDocument: {
					uri: `git://${repoRevSpec.repoURI}?${repoRevSpec.rev}#${path}`,
				},
				position: {
					character: parseInt(target.dataset.byteoffset, 10) - 1,
					line: parseInt(line, 10) - 1,
				},
			},
		});

		return fetch("https://sourcegraph.com/.api/xlang/textDocument/hover", {method: "POST", body: JSON.stringify(body)})
			.then((resp) => resp.json().then((json) => {
				const tooltip = document.createElement("DIV");
				if (json[1].result && json[1].result.contents && json[1].result.contents.length > 0) {
					target.style.cursor = "pointer";
					target.className = `${target.className} sg-clickable`;

					tooltip.className = styles.tooltipTitle;
					tooltip.appendChild(document.createTextNode(json[1].result.contents[0].value));
					tooltipCache[cacheKey] = tooltip;
				} else {
					tooltipCache[cacheKey] = null;
				}
				cb(tooltipCache[cacheKey]);
			})).catch((err) => cb(null));
	}
}
