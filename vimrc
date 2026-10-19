set nocp
set autoindent
set is lbr
set ls=2 mouse=a
set nu ru sc scs smd so=3 sw=4 ts=4
set ignorecase
set relativenumber
set hls
set expandtab

filetype plugin indent on
syntax enable
" set background=light
syn on

map gA m'ggVG"+y''
inoremap jk <Esc>
inoremap {<cr> {<cr>}<ESC>kA<CR>

"Mode Settings
let &t_SI.="\e[5 q" "SI = INSERT mode
let &t_SR.="\e[4 q" "SR = REPLACE mode
let &t_EI.="\e[1 q" "EI = NORMAL mode (ELSE)
"Cursor settings:
"  1 -> blinking block
"  2 -> solid block
"  3 -> blinking underscore
"  4 -> solid underscore
"  5 -> blinking vertical bar
"  6 -> solid vertical bar
