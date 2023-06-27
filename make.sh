set -e

source ~/.tisl/sdks/5.30.00.03.env
COMPILER=ccs

#source ~/.tisl/sdks/7.10.00.98.env
#COMPILER=ticlang

#source ~/.tisl/sdks/6.40.00.13.env
#COMPILER=ticlang

RTOS=$TIRTOSNAME

# for old SDK versions, we need to make the kernel separately
# and patch $DEST/$NAME/tirtos/ccs/makefile"
[[ ${TISL_SDK##*_} = 5.30.00* ]] && \
  echo "Making kernel ..." && \
  make -C kernel/$RTOS/builds/$BOARDNAME/release/$COMPILER && \
  sed -i -e 's/^KERNEL_BUILD\s*:=/KERNEL_BUILD ?=/' app/$RTOS/$COMPILER/makefile && \
  export KERNEL_BUILD="../../../kernel/$RTOS/builds/$BOARDNAME/release"

make -C app/$RTOS/$COMPILER

OUT=app/$RTOS/$COMPILER/*.out
ls -l $OUT

