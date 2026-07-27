from html.parser import HTMLParser


class TableParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.is_in_table = False
        self.is_in_row = False
        self.is_in_data = False
        self.tables = []
        self.current_table = []
        self.current_row = []
        self.current_cell = ""

    def handle_starttag(self, tag, attrs):
        if tag == 'table':
            self.is_in_table = True
        elif tag == 'tr' and self.is_in_table:
            self.is_in_row = True
        elif tag in ('td', 'th') and self.is_in_row:
            self.is_in_data = True
            self.current_cell = ""

    def handle_endtag(self, tag):
        if tag == 'table':
            self.tables.append(self.current_table)
            self.current_table = []
            self.is_in_table = False
        elif tag == 'tr' and self.is_in_row:
            self.current_table.append(self.current_row)
            self.current_row = []
            self.is_in_row = False
        elif tag in ('td', 'th') and self.is_in_data:
            self.current_row.append(self.current_cell)
            self.is_in_data = False

    def handle_data(self, data):
        if self.is_in_data:
            self.current_cell += data.strip()