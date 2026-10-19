let mapleader=" "

"" Copy from jiangge's vim config and do some customizations
" install vim-plug
let s:plugblob = 'https://raw.githubusercontent.com/junegunn/vim-plug/master/plug.vim'
let s:plugfile = stdpath('data').'/site/autoload/plug.vim'
if !filereadable(s:plugfile)
  execute("!curl -fLo '".s:plugfile."' --create-dirs '".s:plugblob."'")
endif

call plug#begin()


" dialects
Plug 'rust-lang/rust.vim'
Plug 'cespare/vim-toml'
Plug 'asciidoc/vim-asciidoc'
" Plug 'mitsuhiko/vim-jinja'
Plug 'google/vim-jsonnet'
Plug 'nathangrigg/vim-beancount'
Plug 'pangloss/vim-javascript'
Plug 'leafgarland/typescript-vim'
Plug 'MaxMEllon/vim-jsx-pretty'
Plug 'peitalin/vim-jsx-typescript'
Plug 'vim-scripts/OIL.vim'
Plug 'uarun/vim-protobuf'
Plug 'solarnz/thrift.vim'

" extensions
Plug 'neoclide/coc.nvim', { 'branch': 'release' }
Plug 'nvim-lua/plenary.nvim'
Plug 'nvim-telescope/telescope.nvim'
Plug 'nvim-telescope/telescope-fzf-native.nvim', { 'do': 'make' }
Plug 'nvim-telescope/telescope-file-browser.nvim'
Plug 'nvim-treesitter/nvim-treesitter', { 'branch': 'master', 'do': ':TSUpdate' }
Plug 'fannheyward/telescope-coc.nvim'
Plug 'LukasPietzschmann/telescope-tabs'
Plug 'scrooloose/nerdcommenter'
"" cs'" 'hello' -> "hello"
Plug 'tpope/vim-surround'
Plug 'lewis6991/gitsigns.nvim'
Plug 'akinsho/bufferline.nvim'
Plug 'moll/vim-bbye'
"" for web dev
Plug 'mattn/emmet-vim'
Plug 'preservim/nerdtree', { 'on': 'NERDTreeToggle' }
Plug 'majutsushi/tagbar', { 'on': 'TagbarToggle' }
" themes
Plug 'nvim-lualine/lualine.nvim'
"Plug 'olimorris/onedarkpro.nvim'
Plug 'navarasu/onedark.nvim'
Plug 'norcalli/nvim-colorizer.lua'
Plug 'ryanoasis/vim-devicons'
Plug 'kyazdani42/nvim-web-devicons'
" https://github.com/tiagofumo/vim-nerdtree-syntax-highlight/pull/54
Plug 'johnstef99/vim-nerdtree-syntax-highlight', { 'on': 'NERDTreeToggle' }
Plug 'iamcco/markdown-preview.nvim', { 'for': 'markdown', 'do': 'cd app && npx --yes yarn install' }

" 1. 依赖项 (Dependencies)
Plug 'MunifTanjim/nui.nvim'

" 2. 主插件 (leetcode.nvim)
" 对应 build = ":TSUpdate html"
" 注意：这假设你已经安装并配置了 nvim-treesitter
Plug 'kawre/leetcode.nvim', { 'do': ':TSUpdate html' }

call plug#end()

" coc extensions
let g:coc_global_extensions = [
  \ 'coc-java',
  \ 'coc-pyright',
  \ 'coc-prettier',
  \ 'coc-solargraph',
  \ 'coc-xml',
  \ 'coc-yaml',
  \ 'coc-json',
  \ 'coc-eslint',
  \ 'coc-tsserver',
  \ 'coc-deno',
  \ 'coc-vetur',
  \ 'coc-rust-analyzer',
  \ 'coc-clangd',
  \ 'coc-texlab',
  \ 'coc-esbonio',
  \ 'coc-go',
  \ 'coc-lua',
  \ 'coc-docker',
  \ 'coc-cmake',
  \ 'coc-vimlsp',
  \ 'coc-diagnostic'
  \]
" Skip this
"if has('mac')
"  let s:llvm_path = system('brew --prefix llvm')
"  let s:clangd_path = trim(s:llvm_path).'/bin/clangd'
"  call coc#config('clangd.path', s:clangd_path)
"endif
if executable('conan')
  let s:conan_path = resolve(resolve(exepath('conan')).'/..')
  let s:conan_py_path = s:conan_path.'/python'
  let s:conan_py_args =
    \ 'import os,site;print(os.linesep.join(site.getsitepackages()))'
  let s:conan_py_site =
    \ split(trim(system(s:conan_py_path.' -c "'.s:conan_py_args.'"')))
  call coc#config('python.analysis.extraPaths', s:conan_py_site)
endif

" telescope extensions
lua << EOF
local telescope = require('telescope')
local actions = require('telescope.actions')
telescope.setup {
  defaults = {
    mappings = {
      i = {
        ['<C-j>'] = actions.move_selection_next,
        ['<C-k>'] = actions.move_selection_previous,
        ['<esc>'] = actions.close,
      },
    },
    path_display = { 'smart' },
    dynamic_preview_title = true,
  },
  extensions = {
    fzf = {
      fuzzy = true,
      override_generic_sorter = true,
      override_file_sorter = true,
      case_mode = 'smart_case',
    },
    file_browser = {
      hijack_netrw = true,
    },
  },
}
telescope.load_extension('fzf')
telescope.load_extension('coc')
telescope.load_extension('file_browser')
telescope.load_extension('telescope-tabs')
EOF

" treesitter extensions
lua << EOF
require 'nvim-treesitter.configs'.setup {
  ensure_installed = {
    'bash', 'beancount', 'c', 'cmake', 'cpp', 'cuda', 'css', 'dockerfile',
    'dot', 'erlang', 'go', 'gomod', 'gowork', 'html', 'java', 'javascript',
    'julia', 'kotlin', 'latex', 'lua', 'make', 'proto', 'python', 'ruby',
    'rust', 'scala', 'scss', 'sql', 'svelte', 'toml', 'tsx', 'typescript',
    'vim', 'yaml',
  },
  sync_install = false,
  highlight = {
    enable = true,
    disable = {
      'proto',
    },
  },
  incremental_selection = {
    enable = true,
    keymaps = {
      init_selection = ",tss",
      scope_incremental = ",tsn",
      node_incremental = ",tnn",
      node_decremental = ",tnp",
    },
  },
}
EOF

lua << END
require('lualine').setup {
	options = {
		icons_enabled = true,
		theme = 'auto', -- based on current vim colorscheme
		-- not a big fan of fancy triangle separators
		component_separators = { left = '', right = '' },
		section_separators = { left = '', right = '' },
		disabled_filetypes = {},
		always_divide_middle = true,
	},
	sections = {
		-- left
		lualine_a = { 'mode' },
		lualine_b = { 'branch', 'diff', 'diagnostics' },
		lualine_c = { 'filename' },
		-- right
		lualine_x = { 'encoding', 'fileformat', 'filetype'},
		lualine_z = { 'location' }
	},
	inactive_sections = {
		lualine_a = { 'filename' },
		lualine_b = {},
		lualine_c = {},
		lualine_x = { 'location' },
		lualine_y = {},
		lualine_z = {}
	},
	tabline = {},
	extensions = {}
}
END

lua << END
require('gitsigns').setup {
  current_line_blame_opts = {
    virt_text = true,
    virt_text_pos = 'eol', -- 'eol' | 'overlay' | 'right_align'
    delay = 100,
    ignore_whitespace = false,
    virt_text_priority = 100,
    use_focus = true,
  }
}
END

lua << END
require("bufferline").setup {
    options = {
        -- 为 NERDTree 留出位置。
        offsets = {{
            filetype = "nerdtree",
            text = "File Explorer",
            highlight = "Directory",
            text_align = "left",
            separator = true -- use a "true" to enable the default, or set your own character
        }}
    }
}
END

lua << EOF
require('leetcode').setup({
    cn = { -- leetcode.cn
        enabled = true, ---@type boolean
        translator = false, ---@type boolean
        translate_problems = false, ---@type boolean
    },
    injector = { ---@type table<lc.lang, lc.inject>
        ["python3"] = {
            imports = function(default_imports)
                vim.list_extend(default_imports, { "from .leetcode import *" })
                return default_imports
            end,
            after = { "def test():", "    print('test')" },
        },
        ["cpp"] = {
            imports = function()
                return {
                    "#include <algorithm>",
                    "#include <array>",
                    "#include <bitset>",
                    "#include <cassert>",
                    "#include <chrono>",
                    "#include <cmath>",
                    "#include <cstdint>",
                    "#include <cstring>",
                    "#include <functional>",
                    "#include <iomanip>",
                    "#include <iostream>",
                    "#include <map>",
                    "#include <numeric>",
                    "#include <queue>",
                    "#include <random>",
                    "#include <set>",
                    "#include <vector>",
                    "", -- 空行
                    "using namespace std;"
                }
            end,
            after = "int main() {}",
        },
    },
})
EOF

lua << END
local status_ok, onedark = pcall(require, "onedark")
if not status_ok then
  vim.notify("onedark theme not found!")
  return
end
-- NOTE: if use 'light' theme, you  should change backgournd and style to 'light'
vim.o.background='dark'
-- vim.o.background='light'
onedark.setup {
  -- Main options --
  style = 'dark', -- Default theme style. Choose between 'dark', 'darker', 'cool', 'deep', 'warm', 'warmer' and 'light'
  transparent = false,  -- Show/hide background
  term_colors = true, -- Change terminal color as per the selected theme style
  ending_tildes = false, -- Show the end-of-buffer tildes. By default they are hidden
  -- toggle theme style ---
  toggle_style_list = {'light', 'dark', 'darker', 'cool', 'deep', 'warm', 'warmer'}, -- List of styles to toggle between
  toggle_style_key = '<leader>ts', -- Default keybinding to toggle

  -- Change code style ---
  -- Options are italic, bold, underline, none
  -- You can configure multiple style with comma seperated, For e.g., keywords = 'italic,bold'
  code_style = {
    comments = 'italic',
    keywords = 'none',
    functions = 'bold',
    strings = 'none',
    variables = 'none'
  },

  -- Custom Highlights --
  colors = {}, -- Override default colors
  highlights = {} -- Override highlight groups
}
onedark.load()
END

" format and user interface
set nocp
set nofoldenable
set mouse=nvc
set autoindent
set is lbr
set ls=2
set nu ru sc scs smd so=3 sw=4 ts=4
set ignorecase
set relativenumber
set hls
set expandtab
set termguicolors
set signcolumn=yes
set updatetime=300
" set cindent
set cinoptions=N-s,g0,j1,(s,m1
set list
set listchars=tab:»\ ,trail:␣,extends:▶,precedes:◀,nbsp:␣


" key mapping
map gA m'ggVG"+y''
inoremap {<cr> {<cr>}<ESC>kA<CR>
inoremap jk <esc>
inoremap <C-L> <right>
vnoremap J :m '>+1<CR>gv=gv
vnoremap K :m '<-2<CR>gv=gv
nnoremap <leader>tb <cmd>TagbarToggle<cr>
nnoremap <leader>tr <cmd>NERDTreeToggle<cr>
nnoremap <leader>nt <cmd>tabnew<cr>
nnoremap <leader>ct <cmd>tabclose<cr>
nnoremap <leader>pc <cmd>pclose<cr>
nnoremap <leader>an <cmd>set norelativenumber<cr>
nnoremap <leader>nh <cmd>nohl<cr>
" nnoremap <tab> <cmd>tabn<cr>
nnoremap <S-TAB> <cmd>tabp<cr>
nnoremap <esc> <cmd>call coc#float#close_all()<cr>
nnoremap <C-P> <cmd>Telescope find_files<cr>
nnoremap <leader>ff <cmd>Telescope find_files<cr>
nnoremap <leader><C-P> <cmd>Telescope builtin theme=dropdown<cr>
nnoremap <leader><S-P> <cmd>Telescope file_browser theme=ivy<cr>
nnoremap <leader><C-J> <cmd>Telescope jumplist theme=dropdown<cr>
nnoremap <leader><C-T> <cmd>Telescope treesitter theme=dropdown<cr>
nnoremap <leader><C-F> <cmd>Telescope live_grep theme=ivy<cr>
nnoremap <leader>fg <cmd>Telescope live_grep theme=dropdown<cr>
nnoremap <leader>psc <cmd>Telescope coc commands theme=dropdown<cr>
nnoremap <leader>psd <cmd>Telescope coc document_symbols theme=dropdown<cr>
nnoremap <leader>psw <cmd>Telescope coc workspace_symbols theme=dropdown<cr>
nnoremap <leader>psr <cmd>Telescope coc references theme=dropdown<cr>
nnoremap <leader>psi <cmd>Telescope coc implementations theme=dropdown<cr>
nnoremap <leader><tab> <cmd>Telescope telescope-tabs list_tabs<cr>
nnoremap <C-J> <C-W>j
nnoremap <C-K> <C-W>k
nnoremap <C-L> <C-W>l
nnoremap <C-H> <C-W>h
nnoremap [g <plug>(coc-diagnostic-prev)
nnoremap ]g <plug>(coc-diagnostic-next)
nnoremap <leader>gd <plug>(coc-definition)
nnoremap <leader>gh <plug>(coc-declaration)
nnoremap <leader>gy <plug>(coc-type-definition)
nnoremap <leader>gi <plug>(coc-implementation)
nnoremap <leader>gr <plug>(coc-references)
nnoremap <leader>gu <plug>(coc-references-used)
nnoremap <leader>gs <cmd>call CocActionAsync('doHover')<cr>
nnoremap <leader>tgd <cmd>call CocActionAsync('jumpDefinition', 'tabe')<cr>
nnoremap <leader>tgh <cmd>call CocActionAsync('jumpDeclaration', 'tabe')<cr>
nnoremap <leader>tgy <cmd>call CocActionAsync('jumpTypeDefinition', 'tabe')<cr>
nnoremap <leader>tgi <cmd>call CocActionAsync('jumpImplementation', 'tabe')<cr>
nnoremap <leader>tgr <cmd>call CocActionAsync('jumpReferences', 'tabe')<cr>
nnoremap <leader>tgu <cmd>call CocActionAsync('jumpUsed', 'tabe')<cr>
nnoremap <leader>vgd <cmd>call CocActionAsync('jumpDefinition', 'vsplit')<cr>
nnoremap <leader>vgh <cmd>call CocActionAsync('jumpDeclaration', 'vsplit')<cr>
nnoremap <leader>vgy <cmd>call CocActionAsync('jumpTypeDefinition', 'vsplit')<cr>
nnoremap <leader>vgi <cmd>call CocActionAsync('jumpImplementation', 'vsplit')<cr>
nnoremap <leader>vgr <cmd>call CocActionAsync('jumpReferences', 'vsplit')<cr>
nnoremap <leader>vgu <cmd>call CocActionAsync('jumpUsed', 'vsplit')<cr>
nnoremap <leader>rst <cmd>CocRestart<cr>
nnoremap <leader>lr <plug>(coc-rename)
xnoremap <leader>fm <plug>(coc-format-selected)
nnoremap <leader>fm <plug>(coc-format-selected)
nnoremap <leader>la <plug>(coc-codeaction-line)
xnoremap <leader>cca <plug>(coc-codeaction-selected)
nnoremap <leader>ccl <plug>(coc-codelens-action)
" Find symbol of current document
nnoremap <silent><nowait> <leader>o  :<C-u>CocList outline<cr>
" Search workspace symbols
nnoremap <silent><nowait> <leader>s  :<C-u>CocList -I symbols<cr>
" git I only need this
nnoremap <leader>hb <cmd>Gitsigns blame_line<cr>
nnoremap <leader>htb <cmd>Gitsigns toggle_current_line_blame<cr>
"" bufferline
nnoremap <leader>bn <cmd>bn<cr>
nnoremap <leader>bp <cmd>bp<cr>
nnoremap <leader>bd <cmd>Bdelete<cr>
nnoremap <S-L> <cmd>bn<cr>
nnoremap <S-H> <cmd>bp<cr>
nnoremap <leader>wq <cmd>wq<cr>
nnoremap <leader>Q <cmd>q!<cr>

function! CheckIsHeadOfLine() abort
  let col = col('.') - 1
  return !col || getline('.')[col - 1] =~# '\s'
endfunction
inoremap <silent><expr> <tab>
  \ coc#pum#visible() ? coc#pum#next(1):
  \ CheckIsHeadOfLine() ? "\<Tab>" : coc#refresh()
inoremap <silent><expr> <S-tab>
  \ coc#pum#visible() ? coc#pum#prev(1) : coc#refresh()
inoremap <silent><expr> <cr>
  \ coc#pum#visible() ? coc#pum#confirm() :
  \ "\<C-g>u\<CR>\<C-r>=coc#on_enter()\<CR>"
inoremap <silent><expr> <C-J>
  \ coc#pum#visible() ? coc#pum#next(1) : "\<C-j>"
inoremap <silent><expr> <C-K>
  \ coc#pum#visible() ? coc#pum#prev(1) : "\<C-k>"
inoremap <silent><expr> <esc>
  \ coc#pum#visible() ? coc#pum#cancel(): "\<Esc>"

" language specific commands
augroup DotfilesFiletype
  autocmd!
  autocmd FileType * setlocal formatoptions-=o
  autocmd FileType *
    \ nnoremap <buffer> <leader>H <cmd>CocCommand document.toggleInlayHint<cr>
  autocmd FileType rust
    \ nnoremap <buffer> <leader>H <cmd>CocCommand rust-analyzer.toggleInlayHints<cr>
  autocmd FileType markdown
    \ nnoremap <buffer> <leader>P <cmd>MarkdownPreviewToggle<cr>
  autocmd User CocJumpPlaceholder
    \ call CocActionAsync('showSignatureHelp')
augroup END

" custom commands
com! -nargs=0 FormatJSON %!python3 -m json.tool
com! -nargs=0 Format     call CocAction('format')
com! -nargs=0 OR         call CocAction('runCommand', 'editor.action.organizeImport')
com! -nargs=0 Tig        Telescope git_commits theme=dropdown
com! -nargs=0 TigC       Telescope git_bcommits theme=dropdown

" automatic commands
lua require'colorizer'.setup()

" global options
"" Add spaces after comment delimiters by default
let g:NERDSpaceDelims = 1

let g:NERDTreeIgnore = [
  \ '\.py[oc]$',
  \ '__pycache__',
  \ '\.egg-info',
  \ '\.[od]$[[file]]'
  \]
let g:NERDTreeStatusline = "NERDTree"
" 优先使用 Universal Ctags，避免 PATH 中的 Emacs ctags。
let g:tagbar_ctags_bin = exepath('ctags')
if executable('brew')
  let s:ctags_path = fnamemodify(exepath('brew'), ':h:h').'/opt/universal-ctags/bin/ctags'
  if executable(s:ctags_path)
    let g:tagbar_ctags_bin = s:ctags_path
  endif
endif
let g:coc_disable_transparent_cursor = 1 " https://github.com/neoclide/coc.nvim/issues/1775#issuecomment-1086225391

" display style
colorscheme onedark
