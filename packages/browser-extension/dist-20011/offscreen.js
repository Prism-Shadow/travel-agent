//#region \0vite/modulepreload-polyfill.js
(function polyfill() {
	const relList = document.createElement("link").relList;
	if (relList && relList.supports && relList.supports("modulepreload")) return;
	for (const link of document.querySelectorAll("link[rel=\"modulepreload\"]")) processPreload(link);
	new MutationObserver((mutations) => {
		for (const mutation of mutations) {
			if (mutation.type !== "childList") continue;
			for (const node of mutation.addedNodes) if (node.tagName === "LINK" && node.rel === "modulepreload") processPreload(node);
		}
	}).observe(document, {
		childList: true,
		subtree: true
	});
	function getFetchOpts(link) {
		const fetchOpts = {};
		if (link.integrity) fetchOpts.integrity = link.integrity;
		if (link.referrerPolicy) fetchOpts.referrerPolicy = link.referrerPolicy;
		if (link.crossOrigin === "use-credentials") fetchOpts.credentials = "include";
		else if (link.crossOrigin === "anonymous") fetchOpts.credentials = "omit";
		else fetchOpts.credentials = "same-origin";
		return fetchOpts;
	}
	function processPreload(link) {
		if (link.ep) return;
		link.ep = true;
		const fetchOpts = getFetchOpts(link);
		fetch(link.href, fetchOpts);
	}
})();
//#endregion
//#region src/offscreen.ts
var recordings = /* @__PURE__ */ new Map();
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	handleMessage(message).then(sendResponse);
	return true;
});
async function handleMessage(message) {
	switch (message.action) {
		case "startRecording": return handleStartRecording(message);
		case "stopRecording": return handleStopRecording(message);
		case "isRecording": return handleIsRecording(message);
		case "cancelRecording": return handleCancelRecording(message);
		default: return {
			success: false,
			error: "Unknown action"
		};
	}
}
async function handleStartRecording(params) {
	const { tabId } = params;
	if (recordings.has(tabId)) return {
		success: false,
		error: `Recording already in progress for tab ${tabId}`
	};
	let stream;
	let recording;
	try {
		const audioConstraints = params.audio ? { mandatory: {
			chromeMediaSource: "tab",
			chromeMediaSourceId: params.streamId
		} } : false;
		const videoConstraints = { mandatory: {
			chromeMediaSource: "tab",
			chromeMediaSourceId: params.streamId,
			minFrameRate: params.frameRate || 30,
			maxFrameRate: params.frameRate || 30
		} };
		stream = await navigator.mediaDevices.getUserMedia({
			audio: audioConstraints,
			video: videoConstraints
		});
		const mimeType = selectRecordingMimeType(params.audio ?? false);
		const recorder = new MediaRecorder(stream, {
			mimeType,
			videoBitsPerSecond: params.videoBitsPerSecond || 25e5,
			audioBitsPerSecond: params.audioBitsPerSecond || 128e3
		});
		const startedAt = Date.now();
		recording = {
			recorder,
			stream,
			startedAt,
			tabId,
			pendingChunks: Promise.resolve(),
			cancelled: false,
			started: false
		};
		recordings.set(tabId, recording);
		const activeRecording = recording;
		recorder.ondataavailable = (event) => {
			if (event.data.size === 0 || activeRecording.cancelled) return;
			enqueueRecordingChunk(activeRecording, event.data);
		};
		recorder.onerror = (event) => {
			const error = toError(event.error, `MediaRecorder failed for tab ${tabId}`);
			activeRecording.recorderError = error;
			console.error(`MediaRecorder error for tab ${tabId}:`, error);
			handleCancelRecordingForTab(tabId, activeRecording.started);
		};
		recorder.onstop = () => {
			console.log(`MediaRecorder stopped for tab ${tabId}`);
		};
		await waitForRecorderStart(recorder, tabId);
		activeRecording.started = true;
		return {
			success: true,
			tabId,
			startedAt,
			mimeType: recorder.mimeType || mimeType
		};
	} catch (error) {
		if (recording) cleanupRecording(recording);
		else if (stream) stopStream(stream);
		console.error(`Failed to start recording for tab ${tabId}:`, error);
		return {
			success: false,
			error: toError(error, "Failed to start recording").message
		};
	}
}
async function handleStopRecording(params) {
	const { tabId } = params;
	const recording = recordings.get(tabId);
	if (!recording) return {
		success: false,
		error: `No active recording for tab ${tabId}`
	};
	try {
		const { recorder, startedAt } = recording;
		await waitForRecorderStop(recorder);
		await recording.pendingChunks;
		if (recording.recorderError) throw recording.recorderError;
		if (recording.chunkError) throw recording.chunkError;
		if (recording.cancelled) throw new Error(`Recording was cancelled for tab ${tabId}`);
		const duration = Date.now() - startedAt;
		await chrome.runtime.sendMessage({
			action: "recordingChunk",
			tabId,
			final: true
		});
		cleanupRecording(recording);
		return {
			success: true,
			tabId,
			duration
		};
	} catch (error) {
		cleanupRecording(recording);
		console.error(`Failed to stop recording for tab ${tabId}:`, error);
		return {
			success: false,
			error: toError(error, "Failed to stop recording").message
		};
	}
}
function handleIsRecording(params) {
	const { tabId } = params;
	const recording = recordings.get(tabId);
	if (!recording) return {
		isRecording: false,
		tabId
	};
	return {
		isRecording: recording.recorder?.state === "recording",
		tabId,
		startedAt: recording.startedAt
	};
}
async function handleCancelRecording(params) {
	const { tabId } = params;
	return handleCancelRecordingForTab(tabId);
}
async function handleCancelRecordingForTab(tabId, notifyBackground = true) {
	const recording = recordings.get(tabId);
	if (!recording) return {
		success: true,
		tabId
	};
	try {
		cleanupRecording(recording);
		if (notifyBackground) await chrome.runtime.sendMessage({
			action: "recordingCancelled",
			tabId
		});
		return {
			success: true,
			tabId
		};
	} catch (error) {
		cleanupRecording(recording);
		console.error(`Failed to cancel recording for tab ${tabId}:`, error);
		return {
			success: false,
			error: toError(error, "Failed to cancel recording").message
		};
	}
}
function enqueueRecordingChunk(recording, blob) {
	recording.pendingChunks = recording.pendingChunks.then(async () => {
		if (recording.cancelled || recording.chunkError) return;
		try {
			const arrayBuffer = await blob.arrayBuffer();
			if (recording.cancelled) return;
			const uint8Array = new Uint8Array(arrayBuffer);
			await chrome.runtime.sendMessage({
				action: "recordingChunk",
				tabId: recording.tabId,
				data: Array.from(uint8Array)
			});
		} catch (error) {
			recording.chunkError = toError(error, `Failed to process recording chunk for tab ${recording.tabId}`);
			console.error(`Failed to process recording chunk for tab ${recording.tabId}:`, error);
		}
	});
}
function selectRecordingMimeType(audio) {
	const mimeType = (audio ? [
		"video/mp4;codecs=avc1.42E01E,mp4a.40.2",
		"video/mp4",
		"video/webm;codecs=vp9,opus",
		"video/webm;codecs=vp8,opus",
		"video/webm"
	] : [
		"video/mp4;codecs=avc1.42E01E",
		"video/mp4",
		"video/webm;codecs=vp9",
		"video/webm;codecs=vp8",
		"video/webm"
	]).find((candidate) => MediaRecorder.isTypeSupported(candidate));
	if (!mimeType) throw new Error("This browser does not support an available screen recording format");
	return mimeType;
}
function waitForRecorderStart(recorder, tabId) {
	return new Promise((resolve, reject) => {
		const cleanupListeners = () => {
			clearTimeout(timeout);
			recorder.removeEventListener("start", onStart);
			recorder.removeEventListener("error", onError);
		};
		const onStart = () => {
			cleanupListeners();
			console.log(`MediaRecorder started for tab ${tabId}`);
			resolve();
		};
		const onError = (event) => {
			cleanupListeners();
			reject(toError(event.error, `MediaRecorder failed to start for tab ${tabId}`));
		};
		const timeout = setTimeout(() => {
			cleanupListeners();
			reject(/* @__PURE__ */ new Error("MediaRecorder failed to start within 5 seconds"));
		}, 5e3);
		recorder.addEventListener("start", onStart);
		recorder.addEventListener("error", onError);
		try {
			recorder.start(1e3);
		} catch (error) {
			cleanupListeners();
			reject(error);
		}
	});
}
function waitForRecorderStop(recorder) {
	if (recorder.state === "inactive") return Promise.resolve();
	return new Promise((resolve, reject) => {
		const cleanupListeners = () => {
			clearTimeout(timeout);
			recorder.removeEventListener("stop", onStop);
			recorder.removeEventListener("error", onError);
		};
		const onStop = () => {
			cleanupListeners();
			resolve();
		};
		const onError = (event) => {
			cleanupListeners();
			reject(toError(event.error, "MediaRecorder failed while stopping"));
		};
		const timeout = setTimeout(() => {
			cleanupListeners();
			reject(/* @__PURE__ */ new Error("MediaRecorder failed to stop within 5 seconds"));
		}, 5e3);
		recorder.addEventListener("stop", onStop);
		recorder.addEventListener("error", onError);
		try {
			recorder.stop();
		} catch (error) {
			cleanupListeners();
			reject(error);
		}
	});
}
function cleanupRecording(recording) {
	recording.cancelled = true;
	if (recording.recorder.state !== "inactive") try {
		recording.recorder.stop();
	} catch (error) {
		console.error(`Failed to stop MediaRecorder for tab ${recording.tabId}:`, error);
	}
	stopStream(recording.stream);
	if (recordings.get(recording.tabId) === recording) recordings.delete(recording.tabId);
}
function stopStream(stream) {
	for (const track of stream.getTracks()) track.stop();
}
function toError(error, fallbackMessage) {
	if (error instanceof Error) return error;
	if (typeof error === "string" && error) return new Error(error);
	return new Error(fallbackMessage);
}
console.log("Penguin Browser offscreen document loaded");
//#endregion
