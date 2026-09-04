import re

with open('server/src/index.js', 'r', encoding='utf-8') as f:
    content = f.read()

events_to_wrap = [
    'room:leave',
    'room:camera-ready',
    'session:start',
    'session:set-layout',
    'session:to-booth',
    'countdown:start',
    'session:end',
    'selection:confirm',
    'customize:done',
    'reveal:push-official',
    'session:make-another'
]

for event in events_to_wrap:
    pattern = r"(socket\.on\('" + event + r"', \([^)]*\) => \{)([\s\S]*?)(\n  \}\);)"
    
    def replacer(match):
        start = match.group(1)
        body = match.group(2)
        end = match.group(3)
        
        if 'try {' in body:
            return match.group(0)
            
        indented = "\n".join("      " + line.strip() for line in body.split("\n") if line.strip())
        
        new_body = f"\n    try {{\n{indented}\n    }} catch (err) {{\n      socket.emit('error', {{ message: err.message }});\n    }}"
        return start + new_body + end

    content = re.sub(pattern, replacer, content)

with open('server/src/index.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Wrapped successfully!")
