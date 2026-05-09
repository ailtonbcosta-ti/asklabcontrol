#!/usr/bin/env python3
"""
Parser de contrato PDF (OCR) → JSON.
"""
import sys, re, json, subprocess, tempfile, pathlib, os, traceback

def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=300, **kw)

def extract_text(pdf_path):
    r = run(['pdftotext', '-layout', '-enc', 'UTF-8', pdf_path, '-'])
    text = r.stdout or ''
    used_ocr = False
    if len(text.strip()) < 100:
        used_ocr = True
        with tempfile.TemporaryDirectory() as td:
            run(['pdftoppm', '-r', '250', '-gray', pdf_path, f'{td}/p'])
            chunks = []
            for img in sorted(pathlib.Path(td).glob('p-*')):
                rr = run(['tesseract', str(img), '-', '-l', 'por', '--psm', '6'])
                chunks.append(rr.stdout or '')
            text = '\n'.join(chunks)
    return text, used_ocr

# ─── Helpers ─────────────────────────────────────────────
DASH_OR_QUOTE = r'[-:.“”"\'’]+'  # tolera "N“:" "Nº:" "N.:" etc.
NUM_REF = r'(\d{1,6}\s*[/.\-]\s*\d{2,4}(?:[\-/][A-Z]+)?)'  # 00013/2025 ou 00796/2025-SDC

def norm_num(s):
    return re.sub(r'\s+', '', s) if s else s

# ─── Cabeçalho ───────────────────────────────────────────
def find_numero_contrato(t):
    patterns = [
        r'CONTRATO\s+N\s*' + DASH_OR_QUOTE + r'\s*' + NUM_REF,
        r'Contrato\s*[\-–]\s*N[ºo°.]?\s*' + NUM_REF,
        r'Contrato\s+(?:Administrativo\s+)?n[ºo°.]?\s*' + NUM_REF,
    ]
    for p in patterns:
        m = re.search(p, t, re.IGNORECASE)
        if m: return norm_num(m.group(1))
    return None

def find_credenciamento(t):
    patterns = [
        r'CREDENCIAMENTO\s+N[®ºo°.]?\s*' + NUM_REF,
        r'credenciamento\s+n[®ºo°.]?\s*' + NUM_REF,
        r'chamamento\s+p[uú]blico\s+n[®ºo°.]?\s*' + NUM_REF,
    ]
    for p in patterns:
        m = re.search(p, t, re.IGNORECASE)
        if m: return norm_num(m.group(1))
    return None

def find_cnpj(t):
    m = re.search(r'(\d{2})[.\s]*(\d{3})[.\s]*(\d{3})[/\\]?(\d{4})[-\s]?(\d{2})', t)
    if m: return ''.join(m.groups())
    return None

def find_razao_social(t):
    """Tenta extrair de blocos típicos."""
    # 1. linha do cabeçalho TCE: "ASSUNTO: Contrato - Nº xxx - <NOME> - Credenciamento"
    m = re.search(
        r'Contrato\s*[\-–]\s*N[ºo°]\s*\d+\s*\/\s*\d+\s*[\-–]\s*([^-\n]+?)\s*[\-–]\s*Credenciamento',
        t, re.IGNORECASE,
    )
    if m: return re.sub(r'\s+', ' ', m.group(1)).strip()
    # 2. busca razão social terminando em LTDA / S.A. / EIRELI / ME / EPP
    m = re.search(
        r'([A-ZÁÉÍÓÚÂÊÔÇÃÕa-záéíóúâêôçãõ][A-ZÁÉÍÓÚÂÊÔÇÃÕa-záéíóúâêôçãõ\s&.\-,]{6,80}'
        r'(?:LTDA(?:\s*[\-–]\s*ME)?|S\s*[/.]?\s*A\.?|EIRELI|ME|EPP))',
        t,
    )
    if m: return re.sub(r'\s+', ' ', m.group(1)).strip()
    return None

# ─── Tabela de procedimentos ─────────────────────────────
# Estratégia line-by-line, tolerante a ruído OCR:
#   1. cada linha que tem "<codigo 6-10 dígitos> - <descrição>" é candidata
#   2. divide pela palavra UNIDADE/UND para isolar a parte numérica
#   3. extrai os números (primeiro int = qtd anual, depois decimais = val_unit, val_total)

NUM_DEC_RE = re.compile(r'\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}|\d+\.\d{2}')
NUM_INT_RE = re.compile(r'\d+')

def br_to_float(s):
    if s is None: return None
    s = s.strip()
    if ',' in s:
        return float(s.replace('.', '').replace(',', '.'))
    return float(s)

def truncate_at_anexos(text):
    """Corta o texto ao primeiro indício de seção que NÃO faz parte do escopo
    contratado (anexos do credenciamento / termo de referência genérico).
    Isso evita que tabelas-de-referência (relação completa de procedimentos
    disponíveis no credenciamento) sejam capturadas como contratadas."""
    cut_patterns = [
        r'\bTERMO\s+DE\s+CREDENCIAMENTO\b',
        r'\bANEXO\s+[IVX]+\s*[-–]\s*TERMO\s+DE\s+REFER[ÊE]NCIA\b',
        r'\bRELA[ÇC][ÃA]O\s+DOS\s+PROCEDIMENTOS\s+CREDENCI',
    ]
    earliest = len(text)
    for p in cut_patterns:
        m = re.search(p, text, re.IGNORECASE)
        if m and m.start() < earliest:
            earliest = m.start()
    return text[:earliest]

def parse_procedimentos(text):
    # corta primeiro nas seções de anexo do edital
    text = truncate_at_anexos(text)
    items = []
    seen = set()
    lines = text.split('\n')
    # joina linhas-de-continuação onde a próxima começa com muitos espaços e não tem código
    merged = []
    for line in lines:
        if merged and re.match(r'^[\s\W]+$', line):
            continue
        if merged and not re.search(r'\d{6,10}\s*[-–]', line) and re.match(r'^\s+\D', line) and len(merged[-1].strip()) > 0:
            # extensão leve: descarta para não interferir
            pass
        merged.append(line)

    # OCR comum confunde 0 com Ò/Ó/Ô/Õ e 1 com Í/Ì
    OCR_DIGIT_MAP = {'Ò': '0', 'Ó': '0', 'Ô': '0', 'Õ': '0', 'Ì': '1', 'Í': '1'}

    for raw in merged:
        line = raw
        # SIGTAP é sempre 10 dígitos; em contratos digitalizados aparece como 9
        # (sem o zero à esquerda). Aceita 9 ou 10. Para 11+ ou 8-, só passa se
        # houver 1 ruído OCR que feche em 9-10.
        cm = re.search(r'(?<!\d)(\d{9,10})([ÒÓÔÕÌÍ]?)\D{0,2}\s*[-–]\s*(.+)$', line)
        if not cm:
            cm = re.search(r'(?<!\d)(\d{8})([ÒÓÔÕÌÍ])\D{0,2}\s*[-–]\s*(.+)$', line)
            if not cm: continue
        codigo, ocr_extra, rest = cm.group(1), cm.group(2), cm.group(3)
        if ocr_extra and len(codigo) < 10:
            codigo += OCR_DIGIT_MAP.get(ocr_extra, '0')
        # exige 9 ou 10 dígitos finais
        if len(codigo) not in (9, 10): continue

        # separa descrição e parte numérica pela palavra UNIDADE/UND
        # tolera acentos/caps errados de OCR (üN, ünIdãdê, UNld..., etc.)
        parts = re.split(
            r'(?:UNI?DA?DE|UND|UN\.?|ÜN[IL]?DÃ?DÊ?)',
            rest, maxsplit=1, flags=re.IGNORECASE,
        )
        if len(parts) < 2:
            # alguns layouts trazem UNIDADE em outra coluna; tenta achar 3 números no fim da linha
            descricao = rest
            tail = ''
        else:
            descricao = parts[0]
            tail = parts[1]

        descricao = re.sub(r'\s{2,}', ' ', descricao).strip()
        descricao = re.sub(r'[\'`´"\']+$', '', descricao).strip()
        if len(descricao) < 4: continue
        if re.match(r'^(total|subtotal|item|lote|p\.?\s*unit|p\.?\s*total|quant)', descricao, re.IGNORECASE):
            continue

        # extrai números: primeiro inteiro = qtd, próximos decimais = val_unit + val_total
        # primeiro tenta tail; se vazio, tenta toda a 'rest'
        target = tail if tail else rest
        # qtd: primeiro inteiro "puro" (sem vírgula/ponto decimal próximo)
        int_match = re.search(r'(?<![\d.,])(\d{1,6})(?![\d.,])', target)
        qtd_str = int_match.group(1) if int_match else None
        if not qtd_str: continue
        # decimais (valor unitário e total)
        decs = NUM_DEC_RE.findall(target[int_match.end():] if int_match else target)
        if not decs: continue
        val_unit_str = decs[0]
        val_total_str = decs[1] if len(decs) > 1 else None

        try:
            qtd = int(qtd_str)
            valor_unit = br_to_float(val_unit_str)
        except Exception:
            continue
        if qtd <= 0 or qtd > 200000: continue
        if not valor_unit or valor_unit <= 0: continue

        if codigo in seen: continue
        seen.add(codigo)
        valor_total = None
        try: valor_total = br_to_float(val_total_str) if val_total_str else None
        except: pass

        items.append({
            'codigo': codigo,
            'descricao': descricao[:250],
            'quantidadeAnual': qtd,
            'qtdMensal': max(1, round(qtd / 12)),
            'valorUnitario': round(valor_unit, 2),
            'valorTotal': round(valor_total, 2) if valor_total else None,
        })
    return items

def main():
    if len(sys.argv) < 2:
        print(json.dumps({'erro': 'PDF não informado'})); sys.exit(2)
    pdf_path = sys.argv[1]
    if not os.path.exists(pdf_path):
        print(json.dumps({'erro': f'Arquivo não encontrado: {pdf_path}'})); sys.exit(2)
    try:
        text, used_ocr = extract_text(pdf_path)
        out = {
            'usadoOcr': used_ocr,
            'numeroContrato': find_numero_contrato(text),
            'numeroCredenciamento': find_credenciamento(text),
            'cnpj': find_cnpj(text),
            'razaoSocial': find_razao_social(text),
            'procedimentos': parse_procedimentos(text),
        }
        out['totalProcedimentos'] = len(out['procedimentos'])
        out['textoSnippet'] = text[:1500]
        print(json.dumps(out, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({'erro': str(e), 'trace': traceback.format_exc()}))
        sys.exit(1)

if __name__ == '__main__':
    main()
