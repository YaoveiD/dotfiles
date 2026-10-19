set showmode

set NERDTree
set surround

let mapleader=" "

inoremap jk <esc>
inoremap Jk <esc>
inoremap JK <esc>
inoremap jK <esc>
inoremap <C-L> <right>
nnoremap 1  ^
nnoremap <leader>tt :NERDTreeToggle<cr>

" https://github.com/JetBrains/ideavim/tree/2.7.5?tab=readme-ov-file#executing-ide-actions
nmap <Tab> <Action>(NextTab)
nmap <S-Tab> <Action>(PreviousTab)
nmap <leader>cl <Action>(CommentByLineComment)
nmap <leader>cu <Action>(CommentByLineComment)
nmap <leader>gd <Action>(GotoDeclaration)
nmap <leader>gi <Action>(GotoImplementation)
nmap <leader>gs <Action>(ShowHoverInfo)
nmap <leader>rn <Action>(RenameElement)
nmap <leader>ff <Action>(ReformatCode)
xmap <leader>ff <Action>(ReformatCode)
nmap <leader>psd <Action>(ShowNavBar)
nmap <leader>psw <Action>(GotoSymbol)
nmap <leader>D <Action>(SmartSearchAction)
nmap <C-P> <Action>(GotoFile)
nmap <leader><C-P> <Action>(GotoAction)
nmap <leader><C-F> <Action>(TextSearchAction)
nmap <leader><C-T> <Action>(ShowNavBar)

" sethandler <C-T> n:vim i-v:ide
