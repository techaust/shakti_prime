# merge-copylint.py: unions the button-key alternations of a conflicted copy-lint config.
import re
p='tools/copy-lint/copy-lint.config.json'; s=open(p,encoding='utf-8').read()
m=re.search(r'<<<<<<< HEAD\n(.*?)\n=======\n(.*?)\n>>>>>>> origin/main\n',s,re.S)
alts=lambda l: re.search(r'\\\.\((.*?)\)\$',l).group(1).split('|')
a=alts(m.group(1)); b=alts(m.group(2)); u=a+[x for x in b if x not in a]
line=re.sub(r'(\\\.\().*?(\)\$)', lambda mm: mm.group(1)+'|'.join(u)+mm.group(2), m.group(1))
s=s[:m.start()]+line+'\n'+s[m.end():]; open(p,'w',encoding='utf-8',newline='').write(s)
