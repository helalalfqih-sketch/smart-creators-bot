import streamlit as st
import os
import subprocess

st.set_page_config(page_title="SMART CREATOR - Diagnostics", layout="wide")

st.markdown("""
    <style>
    h1, h2, h3, p, div { text-align: right; direction: rtl; font-family: 'Cairo', sans-serif; }
    .stCodeBlock { direction: ltr !important; text-align: left !important; }
    </style>
""", unsafe_allow_html=True)

st.title("📊 لوحة تشخيص أعطال بوت SMART CREATOR")
st.write("صوّر هذه الشاشة بالكامل وأرسلها لي لأعرف سبب توقف روابط Douyin فوراً.")
st.markdown("---")

st.header("🔍 أولاً: حالة البوت في الخلفية")
is_bot = subprocess.run(["pgrep", "-f", "bot.py"], capture_output=True).returncode == 0
st.metric(label="حالة البوت الأساسي (bot.py)", value="🟢 يعمل بنجاح في الخلفية" if is_bot else "🔴 متوقف حالياً")

st.markdown("---")

st.header("📋 ثانياً: تفاصيل الأخطاء الحية (Logs)")
log_files = ["bot.log", "project.log", "dashboard.log"]
for log in log_files:
    st.subheader(f"📄 مستند السجل: {log}")
    if os.path.exists(log):
        with open(log, "r", encoding="utf-8", errors="ignore") as f:
            content = "".join(f.readlines()[-60:])
        if content.strip():
            st.code(content, language="text")
        else:
            st.info(f"الملف {log} فارغ حالياً.")
    else:
        st.warning(f"الملف {log} غير موجود.")
