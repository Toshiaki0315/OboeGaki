# スパイク #4: 文字起こしから議事録を作らせる（手元の Ollama だけ）。
import json, sys, time, urllib.request
model, src, dst = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(src, encoding="utf-8").read()
prompt = """次の文字起こしから、日本語の議事録を Markdown で作ってください。

- 見出しは「## 要旨」「## 話されたこと」「## 決まったこと」「## やること」「## 用語」の順
- 「要旨」は 3 行以内。「話されたこと」は話の流れに沿って箇条書き（各項目の頭に [mm:ss] を付ける）
- 「決まったこと」「やること」は、文字起こしに無ければ「なし」と書く。やることは `- [ ] ` で書く
- **文字起こしに書かれていないことは書かない**。評価や感想も書かない
- 文字起こしには音声認識の誤り（同音の取り違え）がある。文脈から明らかなものだけ直してよい

# 文字起こし

""" + text
body = json.dumps({"model": model, "prompt": prompt, "stream": False,
                   "keep_alive": "1m", "options": {"num_ctx": 16384}}).encode()
req = urllib.request.Request("http://127.0.0.1:11434/api/generate", body,
                             {"Content-Type": "application/json"})
t = time.time()
r = json.load(urllib.request.urlopen(req, timeout=1800))
open(dst, "w", encoding="utf-8").write(r["response"])
print(f"{model}: {time.time()-t:.1f} 秒 / 読んだ {r.get('prompt_eval_count')} トークン / 書いた {r.get('eval_count')} トークン")
